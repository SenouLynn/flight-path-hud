/**
 * The node view: instruments, logs, mission, map and sidebar, all following
 * exactly one node. This is the single-node view, and it stays that way — the
 * fleet picture is a separate view with its own map (see FleetView).
 *
 * Owns the state that is meaningful only here: camera modes, video, and which
 * panel columns are on screen. The link, the selection and the basemap live in
 * the shell above, because both views need them and neither should reset the
 * other's.
 */

import { trackLengthM, type VideoHealth } from '@flight-path-hud/gcs-core'
import { IDLE_VIDEO_HEALTH } from '@flight-path-hud/gcs-core'
import { useMemo, useRef, useState } from 'react'
import { HudPanel } from './hud/HudPanel'
import { MapControls, TILTED_PITCH_DEG } from './map/MapControls'
import { MapPanel, type MapHandle } from './map/MapPanel'
import { DEFAULT_VIDEO_URL, VideoPanel } from './video/VideoPanel'
import { BASEMAPS, type TileSource } from './map/tileSource'
import { formatCoord, formatNumber } from './format'
import { LinkPanel } from './LinkPanel'
import { MissionPanel } from './MissionPanel'
import type { VehicleFeedState } from './useVehicleFeed'
import { VIEW_OPTIONS, ViewsMenu, type ViewId } from './ViewsMenu'

/**
 * Column weights. Instruments match the map; parameters get half, since a table
 * of short values needs far less room than either.
 *
 * minmax(0, …) rather than a bare fr: an `fr` track floors at its content's
 * min-content width, and the raw-stream rows are wide and `nowrap`. Without this
 * the logs column expands to fit them and squeezes the other panels to nothing.
 */
const VIEW_WEIGHTS: Record<ViewId, string> = {
  instruments: 'minmax(0, 1fr)',
  map: 'minmax(0, 1fr)',
  video: 'minmax(0, 1fr)',
}

/** `n/a` means the transport cannot measure it, which is not the same as zero. */
function formatMeasured(value: number | null, digits: number, suffix: string): string {
  return value === null ? '—' : `${value.toFixed(digits)}${suffix}`
}

interface NodeViewProps {
  feed: VehicleFeedState
  url: string
  onUrlChange: (url: string) => void
  selectedSystem: string | null
  onSelectSystem: (system: string | null) => void
  tileSource: TileSource
  basemapId: string
  onBasemapChange: (id: string) => void
  /** Back to the roster. */
  onBackToFleet: () => void
}

export function NodeView({
  feed,
  url,
  onUrlChange,
  selectedSystem,
  onSelectSystem,
  tileSource,
  basemapId,
  onBasemapChange,
  onBackToFleet,
}: NodeViewProps) {
  const [follow, setFollow] = useState(true)
  const [trackUp, setTrackUp] = useState(false)
  const [tilted, setTilted] = useState(false)
  const mapHandleRef = useRef<MapHandle | null>(null)

  // Video URL and health live here so the sidebar can show them alongside the
  // other readouts; the panel itself is only the stage.
  const [videoUrl, setVideoUrl] = useState(DEFAULT_VIDEO_URL)
  const [activeVideoUrl, setActiveVideoUrl] = useState(DEFAULT_VIDEO_URL)
  const [videoHealth, setVideoHealth] = useState<VideoHealth>(IDLE_VIDEO_HEALTH)
  const [videoSourceLabel, setVideoSourceLabel] = useState('')
  const [visibleViews, setVisibleViews] = useState<Record<ViewId, boolean>>({
    instruments: true,
    map: true,
    video: true,
  })

  const shownViews = VIEW_OPTIONS.filter((option) => visibleViews[option.id])
  const gridTemplateColumns = shownViews.map((option) => VIEW_WEIGHTS[option.id]).join(' ')

  const toggleView = (id: ViewId) => {
    setVisibleViews((previous) => ({ ...previous, [id]: !previous[id] }))
  }

  /*
   * 3D is exclusive with the vehicle-anchored modes. A tilted camera is for
   * looking around, and Follow/Track up re-anchor it on every telemetry frame,
   * so holding both leaves the perspective view unusable.
   */
  const setTiltedExclusive = (next: boolean) => {
    setTilted(next)
    if (next) {
      setFollow(false)
      setTrackUp(false)
    }
  }

  /*
   * Track up is a modifier on Follow, not a peer. Orienting to a vehicle's heading
   * around a centre the operator chose — with the vehicle possibly off-screen — is
   * disorienting and useless, so the two move together.
   */
  const setFollowExclusive = (next: boolean) => {
    setFollow(next)
    if (next) {
      setTilted(false)
    } else {
      setTrackUp(false)
    }
  }

  const setTrackUpExclusive = (next: boolean) => {
    setTrackUp(next)
    if (next) {
      setFollow(true)
      setTilted(false)
    }
  }

  /*
   * Reaching for the map hands the camera over: the vehicle-anchored modes step
   * aside so the drag works immediately, rather than being refused or overwritten
   * on the next telemetry frame.
   *
   * Deliberately does NOT force a tilt — a sideways pan that suddenly pitched the
   * map would be its own surprise. The 3D toggle stays a statement about pitch.
   */
  const handOverCamera = () => {
    setFollow(false)
    setTrackUp(false)
  }

  const trackKm = useMemo(
    () => trackLengthM({ points: feed.track }) / 1000,
    [feed.track],
  )

  const vehicle = feed.vehicle

  return (
    <div className="gcs-layout">
      <header className="gcs-topbar">
        <button type="button" className="segment" onClick={onBackToFleet} title="Back to the fleet roster">
          ← Fleet
        </button>
        <span className="app-title">Ground control</span>
        <ViewsMenu visible={visibleViews} onToggle={toggleView} />
      </header>

      <aside className="gcs-sidebar">
        <LinkPanel
          url={url}
          onUrlChange={onUrlChange}
          connectionState={feed.connectionState}
          frameCount={feed.frameCount}
          decodeErrorCount={feed.decodeErrorCount}
        />

        <section className="panel">
          <h2>System</h2>
          <label className="control">
            <span>Active system</span>
            <select
              value={selectedSystem ?? ''}
              onChange={(event) => onSelectSystem(event.target.value === '' ? null : event.target.value)}
            >
              <option value="">Auto (latest)</option>
              {feed.knownSystems.map((system) => (
                <option key={system} value={system}>{system}</option>
              ))}
            </select>
          </label>
          {feed.knownSystems.length > 1 ? (
            <p className="warn">
              {feed.knownSystems.length} systems on this link. If that is unexpected, you may have
              duplicate transmitters.
            </p>
          ) : null}
        </section>

        <MissionPanel
          mission={feed.mission}
          replayMode={feed.replayMode}
          hasVehicle={vehicle !== null}
          connectionState={feed.connectionState}
          onLoadMission={() => vehicle !== null && feed.requestMission(vehicle.sysId, vehicle.compId)}
          onSelectWaypoint={(latDeg, lonDeg) => {
            // Same hand-over as a manual drag: Follow's per-frame recentre
            // would otherwise snap straight back to the vehicle before the
            // operator ever sees the waypoint they just clicked.
            handOverCamera()
            mapHandleRef.current?.panTo(latDeg, lonDeg)
          }}
        />

        {visibleViews.video ? (
          <section className="panel">
            <h2>Video Link</h2>
            <label className="control">
              <span>Stream URL</span>
              <input
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                // Committed on blur or Enter so the stream is not torn down and
                // reconnected on every keystroke.
                onBlur={() => setActiveVideoUrl(videoUrl)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setActiveVideoUrl(videoUrl)
                  }
                }}
                spellCheck={false}
              />
            </label>
            <div className="stat">
              <span>State</span>
              <strong className={`connection-state ${videoHealth.connectionState}`}>
                {videoHealth.connectionState}
              </strong>
            </div>
            <div className="stat"><span>Transport</span><strong>{videoSourceLabel || '—'}</strong></div>
            <div className="stat"><span>FPS</span><strong>{formatMeasured(videoHealth.fps, 1, '')}</strong></div>
            <div className="stat"><span>Bitrate</span><strong>{formatMeasured(videoHealth.bitrateKbps, 0, ' kbps')}</strong></div>
            <div className="stat"><span>Frames</span><strong>{videoHealth.framesDecoded}</strong></div>
            <div className="stat"><span>Reconnects</span><strong>{videoHealth.reconnectCount}</strong></div>
          </section>
        ) : null}

        <section className="panel">
          <h2>Position</h2>
          <div className="stat"><span>Latitude</span><strong>{formatCoord(vehicle?.latDeg ?? null)}</strong></div>
          <div className="stat"><span>Longitude</span><strong>{formatCoord(vehicle?.lonDeg ?? null)}</strong></div>
          <div className="stat"><span>Alt MSL</span><strong>{formatNumber(vehicle?.altMslM ?? null, 1, ' m')}</strong></div>
          <div className="stat"><span>Alt rel</span><strong>{formatNumber(vehicle?.altRelM ?? null, 1, ' m')}</strong></div>
          <div className="stat"><span>Heading</span><strong>{formatNumber(vehicle?.headingDeg ?? null, 0, '°')}</strong></div>
          <div className="stat"><span>Heading src</span><strong>{vehicle?.headingSource ?? 'none'}</strong></div>
          <div className="stat"><span>Ground speed</span><strong>{formatNumber(vehicle?.groundSpeedMps ?? null, 1, ' m/s')}</strong></div>
        </section>

        <section className="panel">
          <h2>Trail</h2>
          <div className="stat"><span>Points</span><strong>{feed.track.length}</strong></div>
          <div className="stat"><span>Distance</span><strong>{trackKm.toFixed(2)} km</strong></div>
        </section>

      </aside>

      {/*
        Panels render by mapping VIEW_OPTIONS, so DOM order always matches the
        column weights built from the same list.
      */}
      <main className="gcs-main" style={{ gridTemplateColumns }}>
        {shownViews.map((option) => (
          <div key={option.id} className={option.id === 'map' ? 'view-pane map-pane' : 'view-pane'}>
            {option.id === 'video' ? (
              <VideoPanel
                url={activeVideoUrl}
                onHealth={setVideoHealth}
                onSourceLabel={setVideoSourceLabel}
              />
            ) : null}
            {option.id === 'instruments' ? (
              <HudPanel sample={feed.sample} track={feed.enuTrack} log={feed.log} />
            ) : null}
            {option.id === 'map' ? (
              <>
                <MapPanel
                  ref={mapHandleRef}
                  vehicle={vehicle}
                  track={feed.track}
                  tileSource={tileSource}
                  follow={follow}
                  trackUp={trackUp}
                  pitchDeg={tilted ? TILTED_PITCH_DEG : 0}
                  onCameraGrab={handOverCamera}
                  onUserPitch={() => setTilted(false)}
                  mission={feed.mission}
                  home={feed.home}
                />
                <MapControls
                  basemaps={BASEMAPS}
                  basemapId={basemapId}
                  onBasemapChange={onBasemapChange}
                  follow={follow}
                  onFollowChange={setFollowExclusive}
                  trackUp={trackUp}
                  onTrackUpChange={setTrackUpExclusive}
                  tilted={tilted}
                  onTiltedChange={setTiltedExclusive}
                  onResetView={() => {
                    setTrackUp(false)
                    setTilted(false)
                    mapHandleRef.current?.resetNorth()
                  }}
                  maxZoom={tileSource.maxZoom}
                />
              </>
            ) : null}
          </div>
        ))}
        {shownViews.length === 0 ? (
          <p className="views-empty">No views selected. Pick one from Views above.</p>
        ) : null}
      </main>
    </div>
  )
}
