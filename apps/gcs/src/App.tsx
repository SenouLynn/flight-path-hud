import { IDLE_VIDEO_HEALTH, trackLengthM, type VideoHealth } from '@flight-path-hud/gcs-core'
import { useMemo, useRef, useState } from 'react'
import { HudPanel } from './hud/HudPanel'
import { MapControls, TILTED_PITCH_DEG } from './map/MapControls'
import { MapPanel, type MapHandle } from './map/MapPanel'
import { DEFAULT_VIDEO_URL, VideoPanel } from './video/VideoPanel'
import { BASEMAPS, DEFAULT_BASEMAP, findBasemap } from './map/tileSource'
import { useVehicleFeed } from './useVehicleFeed'
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

const DEFAULT_URL = 'ws://localhost:8080/telemetry'

function formatCoord(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(6)
}

function formatNumber(value: number | null, digits = 1, suffix = ''): string {
  return value === null ? 'N/A' : `${value.toFixed(digits)}${suffix}`
}

/** `n/a` means the transport cannot measure it, which is not the same as zero. */
function formatMeasured(value: number | null, digits: number, suffix: string): string {
  return value === null ? '—' : `${value.toFixed(digits)}${suffix}`
}

function App() {
  const [url, setUrl] = useState(DEFAULT_URL)
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id)
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

  const feed = useVehicleFeed({ url, selectedSystem })
  const tileSource = useMemo(() => findBasemap(basemapId), [basemapId])

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
        <span className="app-title">Ground control</span>
        <ViewsMenu visible={visibleViews} onToggle={toggleView} />
      </header>

      <aside className="gcs-sidebar">
        <section className="panel">
          <h2>Link</h2>
          <label className="control">
            <span>WebSocket URL</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
          </label>
          <div className="stat">
            <span>Connection</span>
            <strong className={`connection-state ${feed.connectionState}`}>{feed.connectionState}</strong>
          </div>
          <div className="stat"><span>Frames</span><strong>{feed.frameCount}</strong></div>
          <div className="stat"><span>Decode errors</span><strong>{feed.decodeErrorCount}</strong></div>
        </section>

        <section className="panel">
          <h2>System</h2>
          <label className="control">
            <span>Active system</span>
            <select
              value={selectedSystem ?? ''}
              onChange={(event) => setSelectedSystem(event.target.value === '' ? null : event.target.value)}
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
                />
                <MapControls
                  basemaps={BASEMAPS}
                  basemapId={basemapId}
                  onBasemapChange={setBasemapId}
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

export default App
