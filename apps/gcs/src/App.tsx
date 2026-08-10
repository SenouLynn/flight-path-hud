import { trackLengthM } from '@flight-path-hud/gcs-core'
import { useMemo, useState } from 'react'
import { HudPanel } from './hud/HudPanel'
import { MapPanel } from './map/MapPanel'
import { BASEMAPS, DEFAULT_BASEMAP, findBasemap } from './map/tileSource'
import { useVehicleFeed } from './useVehicleFeed'

const DEFAULT_URL = 'ws://localhost:8080/telemetry'

function formatCoord(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(6)
}

function formatNumber(value: number | null, digits = 1, suffix = ''): string {
  return value === null ? 'N/A' : `${value.toFixed(digits)}${suffix}`
}

function App() {
  const [url, setUrl] = useState(DEFAULT_URL)
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id)
  const [showHud, setShowHud] = useState(false)

  const feed = useVehicleFeed({ url, selectedSystem })
  const tileSource = useMemo(() => findBasemap(basemapId), [basemapId])

  const trackKm = useMemo(
    () => trackLengthM({ points: feed.track }) / 1000,
    [feed.track],
  )

  const vehicle = feed.vehicle

  return (
    <div className="gcs-layout">
      <header className="gcs-topbar">
        <div className="brand">
          <span className="eyebrow">Ground control</span>
          <span className="brand-title">Map</span>
        </div>

        <div className="topbar-controls">
          <label className="topbar-field">
            <span>Basemap</span>
            <select value={basemapId} onChange={(event) => setBasemapId(event.target.value)}>
              {BASEMAPS.map((basemap) => (
                <option key={basemap.id} value={basemap.id}>{basemap.label}</option>
              ))}
            </select>
          </label>

          <span className="topbar-meta">max z{tileSource.maxZoom}</span>

          <button
            type="button"
            title="Keep the map centred on the vehicle"
            className={follow ? 'segment active' : 'segment'}
            onClick={() => setFollow((previous) => !previous)}
            aria-pressed={follow}
          >
            Follow
          </button>

          <button
            type="button"
            title="Show the unified HUD instruments over the map"
            className={showHud ? 'segment active' : 'segment'}
            onClick={() => setShowHud((previous) => !previous)}
            aria-pressed={showHud}
          >
            HUD
          </button>
        </div>
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

      {/* The map is always mounted; the instruments are an optional column beside it. */}
      <main className={showHud ? 'gcs-main with-hud' : 'gcs-main'}>
        {showHud ? (
          <div className="hud-pane">
            <HudPanel sample={feed.sample} track={feed.enuTrack} />
          </div>
        ) : null}
        <div className="map-pane">
          <MapPanel vehicle={vehicle} track={feed.track} tileSource={tileSource} follow={follow} />
        </div>
      </main>
    </div>
  )
}

export default App
