import { useMemo, useState } from 'react'
import { AircraftControlsPanel } from '../components/AircraftControlsPanel'
import { HudFlightPathRecorder } from '../components/HudFlightPathRecorder'
import { HudHeadingIndicator } from '../components/HudHeadingIndicator'
import { HudOrientationIndicator } from '../components/HudOrientationIndicator'
import { HudPredictiveTrajectory } from '../components/HudPredictiveTrajectory'
import { HudPrimaryFlightDisplay } from '../components/HudPrimaryFlightDisplay'
import { HudUnifiedInstrument } from '../components/HudUnifiedInstrument'
import { useAircraftControls } from '../hooks/useAircraftControls'
import { resolveAttitude } from '../logic/attitude'
import { resolveScalarTelemetry } from '../logic/flightPath'
import { resolveHeading } from '../logic/heading'
import { DEFAULT_TRAJECTORY_CONFIG, resolveCoordinationLabel, resolvePredictiveTrajectory } from '../logic/trajectory'
import { buildStaticSample } from '../stream/staticSample'
import {
    buildSyntheticMissionSamples,
    createLiveMockSource,
    createSyntheticReplaySource,
    type TelemetrySource,
    type TelemetrySourceId,
} from '../stream/telemetrySource'
import { useFlightTrack } from '../stream/useFlightTrack'
import { useTelemetryFeed } from '../stream/useTelemetryFeed'
import { createWsTelemetrySource } from '../stream/wsTelemetrySource'

const RAD_TO_DEG = 180 / Math.PI

interface UnifiedDisplayPreset {
  id: 'standard' | 'mono128x64-portrait' | 'rgb240x320-portrait'
  label: string
  targetWidth: number
  targetHeight: number
  headingHeight: number
  headingProfile: 'default' | 'micro' | 'portrait'
  hudProfile: 'default' | 'micro' | 'portrait'
  previewScale: number
  notes: string
}

const STANDARD_HEADING_HEIGHT = 24
const STANDARD_INSTRUMENT_WIDTH = 1000
const STANDARD_INSTRUMENT_HEIGHT = 440
const STANDARD_TOTAL_HEIGHT = STANDARD_HEADING_HEIGHT + STANDARD_INSTRUMENT_HEIGHT

const UNIFIED_DISPLAY_PRESETS: UnifiedDisplayPreset[] = [
  {
    id: 'standard',
    label: 'Standard',
    targetWidth: STANDARD_INSTRUMENT_WIDTH,
    targetHeight: STANDARD_TOTAL_HEIGHT,
    headingHeight: STANDARD_HEADING_HEIGHT,
    headingProfile: 'default',
    hudProfile: 'default',
    previewScale: 1,
    notes: 'Current desktop baseline view.',
  },
  {
    id: 'mono128x64-portrait',
    label: '128x64 Portrait',
    targetWidth: 64,
    targetHeight: 128,
    headingHeight: 10,
    headingProfile: 'micro',
    hudProfile: 'micro',
    previewScale: 4,
    notes: 'Monochrome 128x64 panel in vertical orientation, using a simplified micro layout.',
  },
  {
    id: 'rgb240x320-portrait',
    label: '240x320 Portrait',
    targetWidth: 240,
    targetHeight: 320,
    headingHeight: 22,
    headingProfile: 'portrait',
    hudProfile: 'portrait',
    previewScale: 1.6,
    notes: '240RGBx320 target for beam-splitter evaluation.',
  },
]

function formatNumber(value: number | null, precision = 2): string {
  return value === null ? 'N/A' : value.toFixed(precision)
}

type UnifiedInputSourceId = 'controls-static' | TelemetrySourceId

function formatSourceInterval(source: TelemetrySource | null): string {
  if (source === null) {
    return 'manual controls'
  }

  if (source.intervalMs <= 0) {
    return 'event-driven'
  }

  return `${source.intervalMs} ms`
}

function UnifiedView() {
  const [displayPresetId, setDisplayPresetId] = useState<UnifiedDisplayPreset['id']>('standard')
  const [sourceId, setSourceId] = useState<UnifiedInputSourceId>('controls-static')
  const [externalWsUrl, setExternalWsUrl] = useState('ws://localhost:8080/telemetry')

  const {
    rollDeg, setRollDeg,
    pitchDeg, setPitchDeg,
    pitchRateDps, setPitchRateDps,
    yawRateDps, setYawRateDps,
    airSpeedMps, setAirSpeedMps,
    flightPathAngleDeg, setFlightPathAngleDeg,
    headingDeg, setHeadingDeg,
    stallSpeedMps, setStallSpeedMps,
  } = useAircraftControls(DEFAULT_TRAJECTORY_CONFIG.stallSpeedMps)

  const sample = useMemo(
    () => buildStaticSample({
      rollDeg,
      pitchDeg,
      headingDeg,
      airSpeedMps,
      flightPathAngleDeg,
      pitchRateDegPerSec: pitchRateDps,
      yawRateDegPerSec: yawRateDps,
    }),
    [rollDeg, pitchDeg, headingDeg, airSpeedMps, flightPathAngleDeg, pitchRateDps, yawRateDps],
  )

  const streamSamples = useMemo(() => buildSyntheticMissionSamples(60, 180), [])

  const telemetrySources = useMemo<Record<TelemetrySourceId, TelemetrySource>>(() => {
    const synthetic = createSyntheticReplaySource(streamSamples, 300)
    const liveMock = createLiveMockSource(100)
    const wsExternal = createWsTelemetrySource({
      url: externalWsUrl,
      label: 'External stream (ws)',
    })

    return {
      'synthetic-replay': synthetic,
      'live-mock': liveMock,
      'ws-external': wsExternal,
    }
  }, [externalWsUrl, streamSamples])

  const activeSource = sourceId === 'controls-static' ? null : telemetrySources[sourceId]
  const feed = useTelemetryFeed(activeSource)
  const resolvedSample = activeSource === null ? sample : (feed.latestSample ?? sample)
  const trackConfig = useMemo(
    () => (sourceId === 'live-mock' || sourceId === 'ws-external'
      ? { maxPoints: 600, maxAgeSec: 45 }
      : { maxPoints: 4000 }),
    [sourceId],
  )
  const flightTrack = useFlightTrack(feed, sourceId, trackConfig)

  const trajectoryConfig = useMemo(
    () => ({ ...DEFAULT_TRAJECTORY_CONFIG, stallSpeedMps }),
    [stallSpeedMps],
  )

  const attitude = resolveAttitude(resolvedSample)
  const heading = resolveHeading(resolvedSample)
  const scalar = resolveScalarTelemetry(resolvedSample)
  const trajectory = resolvePredictiveTrajectory(resolvedSample, trajectoryConfig)
  const coordination = resolveCoordinationLabel(trajectory.turnRateRadPerSec, trajectory.coordinatedTurnRateRadPerSec)
  const turnRateDps = trajectory.turnRateRadPerSec * RAD_TO_DEG
  const coordinatedDps = trajectory.coordinatedTurnRateRadPerSec * RAD_TO_DEG
  const activePreset = UNIFIED_DISPLAY_PRESETS.find((preset) => preset.id === displayPresetId) ?? UNIFIED_DISPLAY_PRESETS[0]
  const headingHeightPx = Math.max(8, activePreset.headingHeight)
  const instrumentHeightPx = Math.max(24, activePreset.targetHeight - headingHeightPx)
  const previewWidthPx = activePreset.targetWidth * activePreset.previewScale
  const previewHeightPx = activePreset.targetHeight * activePreset.previewScale
  const aspectRatioLabel = `${activePreset.targetWidth}:${activePreset.targetHeight}`
  const isStandardPreset = activePreset.id === 'standard'
  const profilePreviewStyle = isStandardPreset
    ? {
      width: '100%',
      aspectRatio: `${activePreset.targetWidth} / ${activePreset.targetHeight}`,
    }
    : {
      width: `${previewWidthPx}px`,
      height: `${previewHeightPx}px`,
    }
  const connectionClass = `connection-state ${feed.streamHealth.connectionState}`
  const latestSampleTimestamp = feed.latestSample?.timestampMs ?? null
  const liveYawDeg = resolvedSample.attitude?.yawRad === undefined
    ? null
    : (resolvedSample.attitude.yawRad * RAD_TO_DEG)

  return (
    <div className="playground-layout">
      <aside className="playground-sidebar" aria-label="Unified instrument controls">
        <section className="header playground-header">
          <p className="eyebrow">Iterating toward one instrument</p>
          <p className="intro">
            First pass: attitude ladder + heading merged with the predictive flight-path projection. The instrument itself stays graphics-only; resolver outputs are broken out above it.
          </p>
        </section>

        <section className="panel playground-control-panel">
          <div className="panel-header">
            <h2>Display Profile</h2>
            <p className="panel-subtitle">Quick-fit presets for target HUD screen geometries.</p>
          </div>
          <div className="display-preset-grid" role="radiogroup" aria-label="Unified HUD display profile">
            {UNIFIED_DISPLAY_PRESETS.map((preset) => {
              const isActive = preset.id === activePreset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`display-preset-button${isActive ? ' active' : ''}`}
                  onClick={() => setDisplayPresetId(preset.id)}
                >
                  <span className="display-preset-label">{preset.label}</span>
                  <span className="display-preset-meta">
                    {preset.targetWidth}x{preset.targetHeight}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="display-preset-note">
            {activePreset.notes} Active canvas: {activePreset.targetWidth}x{activePreset.targetHeight}px ({aspectRatioLabel}), scaled {activePreset.previewScale.toFixed(1)}x for on-screen preview.
          </p>
        </section>

        <section className="panel playground-control-panel">
          <div className="panel-header">
            <h2>Data Source</h2>
            <p className="panel-subtitle">Switch between static controls, synthetic replay, live mock stream, and external WebSocket telemetry.</p>
          </div>
          <div className="adapter-controls source-controls-grid">
            <label className="adapter-control">
              <span>Source</span>
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value as UnifiedInputSourceId)}>
                <option value="controls-static">Static controls</option>
                {Object.values(telemetrySources).map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </select>
            </label>
            <div className="adapter-stat"><span>Packet cadence</span><strong>{formatSourceInterval(activeSource)}</strong></div>
            <div className="adapter-stat"><span>Packets seen</span><strong>{feed.packetCount}</strong></div>
            <div className="adapter-stat"><span>Last sample ts</span><strong>{latestSampleTimestamp === null ? 'N/A' : latestSampleTimestamp}</strong></div>
          </div>
          {sourceId === 'ws-external' ? (
            <label className="adapter-control source-url-input">
              <span>WebSocket URL</span>
              <input
                type="text"
                value={externalWsUrl}
                onChange={(event) => setExternalWsUrl(event.target.value)}
                spellCheck={false}
              />
            </label>
          ) : null}
        </section>

        {sourceId === 'controls-static' ? (
          <AircraftControlsPanel
            rollDeg={rollDeg}
            setRollDeg={setRollDeg}
            pitchDeg={pitchDeg}
            setPitchDeg={setPitchDeg}
            pitchRateDps={pitchRateDps}
            setPitchRateDps={setPitchRateDps}
            yawRateDps={yawRateDps}
            setYawRateDps={setYawRateDps}
            airSpeedMps={airSpeedMps}
            setAirSpeedMps={setAirSpeedMps}
            flightPathAngleDeg={flightPathAngleDeg}
            setFlightPathAngleDeg={setFlightPathAngleDeg}
            headingDeg={headingDeg}
            setHeadingDeg={setHeadingDeg}
            stallSpeedMps={stallSpeedMps}
            setStallSpeedMps={setStallSpeedMps}
          />
        ) : (
          <section className="panel playground-control-panel">
            <p className="source-mode-note">
              Static aircraft controls are disabled while live or replay sources are active. Switch back to Static controls to resume manual parameter testing.
            </p>
          </section>
        )}
      </aside>

      <div className="playground-content">
        <section className="panel playground-derived-values">
          <div className="panel-header">
            <h2>Derived Values</h2>
            <p className="panel-subtitle">Live resolver outputs and stream health for the current test case.</p>
          </div>
          <div className="playground-readout">
            <div className={`readout-stat${trajectory.isStalled ? ' readout-stat-warn' : ''}`}>
              <span>Stall state</span>
              <strong>{trajectory.isStalled ? 'BELOW STALL' : 'flying'}</strong>
            </div>
            <div className="readout-stat"><span>Coordination</span><strong>{coordination}</strong></div>
            <div className="readout-stat"><span>Turn rate (actual)</span><strong>{formatNumber(turnRateDps, 1)} °/s</strong></div>
            <div className="readout-stat"><span>Coordinated ref (g·tanφ/V)</span><strong>{formatNumber(coordinatedDps, 1)} °/s</strong></div>
            <div className="readout-stat"><span>Flight-path angle</span><strong>{formatNumber(trajectory.flightPathAngleDeg, 1)}°</strong></div>
            <div className="readout-stat"><span>Vertical rate</span><strong>{formatNumber(trajectory.verticalRateMps)} m/s</strong></div>
            <div className="readout-stat"><span>Climb-angle rate</span><strong>{formatNumber(trajectory.climbAngleRateRadPerSec * RAD_TO_DEG, 1)} °/s</strong></div>
            <div className="readout-stat"><span>Resolved pitch</span><strong>{formatNumber(attitude.pitchDeg)}°</strong></div>
            <div className="readout-stat"><span>Resolved roll</span><strong>{formatNumber(attitude.rollDeg)}°</strong></div>
            <div className="readout-stat"><span>Resolved heading</span><strong>{formatNumber(heading.headingDeg)}° ({heading.source})</strong></div>
            <div className="readout-stat"><span>Airspeed</span><strong>{formatNumber(scalar.airSpeedMps)} m/s ({formatNumber(scalar.airSpeedKnots, 1)} kt)</strong></div>
            <div className="readout-stat"><span>Stall speed</span><strong>{formatNumber(trajectory.stallSpeedMps)} m/s</strong></div>
          </div>
          <div className="adapter-controls stream-health-grid">
            <div className="adapter-stat">
              <span>Connection</span>
              <strong className={connectionClass}>{feed.streamHealth.connectionState}</strong>
            </div>
            <div className="adapter-stat"><span>Packet rate</span><strong>{feed.streamHealth.packetRateHz.toFixed(0)} /s</strong></div>
            <div className="adapter-stat"><span>Decode errors</span><strong>{feed.streamHealth.decodeErrorCount}</strong></div>
            <div className="adapter-stat"><span>Dropped packets</span><strong>{feed.streamHealth.droppedPacketCount}</strong></div>
            <div className="adapter-stat"><span>Heartbeat age</span><strong>{feed.streamHealth.lastHeartbeatAgeMs} ms</strong></div>
          </div>
        </section>

        <section className="panel playground-instruments">
          <div className="panel-header">
            <h2>Unified Instrument</h2>
            <p className="panel-subtitle">Unified HUD plus expanded instrument panes from the validator stack.</p>
          </div>
          <div className={`hud-profile-preview${isStandardPreset ? ' hud-profile-preview-fluid' : ''}`} style={profilePreviewStyle}>
            <div className="hud-profile-screen">
              <div className="hud-fused-shell hud-fused-shell-screen">
                <div className="hud-main-row hud-main-row-screen">
                  <HudHeadingIndicator
                    headingDeg={heading.headingDeg}
                    width={activePreset.targetWidth}
                    height={headingHeightPx}
                    profile={activePreset.headingProfile}
                  />
                </div>
                <div className="hud-secondary-card hud-secondary-card-screen">
                  <HudUnifiedInstrument
                    sample={resolvedSample}
                    config={trajectoryConfig}
                    width={activePreset.targetWidth}
                    height={instrumentHeightPx}
                    profile={activePreset.hudProfile}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="unified-instrument-grid-wrap">
            <div className="unified-instrument-grid">
              <div className="hud-secondary-card">
                <HudPrimaryFlightDisplay
                  headingDeg={heading.headingDeg}
                  pitchDeg={attitude.pitchDeg}
                  rollDeg={attitude.rollDeg}
                  width={420}
                  height={420}
                  headingHeight={30}
                />
              </div>
              <div className="hud-secondary-card">
                <HudOrientationIndicator
                  rollDeg={attitude.rollDeg}
                  pitchDeg={attitude.pitchDeg}
                  yawDeg={liveYawDeg}
                  width={420}
                  height={280}
                />
              </div>
              <div className="hud-secondary-card">
                <HudPredictiveTrajectory
                  sample={resolvedSample}
                  config={trajectoryConfig}
                  width={420}
                  height={280}
                />
              </div>
              <div className="hud-secondary-card">
                <HudFlightPathRecorder
                  track={flightTrack.track}
                  source={flightTrack.source}
                  width={420}
                  height={280}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default UnifiedView
