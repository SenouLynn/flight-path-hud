import { useMemo, useState } from 'react'
import { AircraftControlsPanel } from '../components/AircraftControlsPanel'
import { HudHeadingIndicator } from '../components/HudHeadingIndicator'
import { HudUnifiedInstrument } from '../components/HudUnifiedInstrument'
import { useAircraftControls } from '../hooks/useAircraftControls'
import { resolveAttitude } from '../logic/attitude'
import { resolveScalarTelemetry } from '../logic/flightPath'
import { resolveHeading } from '../logic/heading'
import { DEFAULT_TRAJECTORY_CONFIG, resolveCoordinationLabel, resolvePredictiveTrajectory } from '../logic/trajectory'
import { buildStaticSample } from '../stream/staticSample'

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

function UnifiedView() {
  const [displayPresetId, setDisplayPresetId] = useState<UnifiedDisplayPreset['id']>('standard')

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

  const trajectoryConfig = useMemo(
    () => ({ ...DEFAULT_TRAJECTORY_CONFIG, stallSpeedMps }),
    [stallSpeedMps],
  )

  const attitude = resolveAttitude(sample)
  const heading = resolveHeading(sample)
  const scalar = resolveScalarTelemetry(sample)
  const trajectory = resolvePredictiveTrajectory(sample, trajectoryConfig)
  const coordination = resolveCoordinationLabel(trajectory.turnRateRadPerSec, trajectory.coordinatedTurnRateRadPerSec)
  const turnRateDps = trajectory.turnRateRadPerSec * RAD_TO_DEG
  const coordinatedDps = trajectory.coordinatedTurnRateRadPerSec * RAD_TO_DEG
  const activePreset = UNIFIED_DISPLAY_PRESETS.find((preset) => preset.id === displayPresetId) ?? UNIFIED_DISPLAY_PRESETS[0]
  const headingHeightPx = Math.max(8, activePreset.headingHeight)
  const instrumentHeightPx = Math.max(24, activePreset.targetHeight - headingHeightPx)
  const previewWidthPx = activePreset.targetWidth * activePreset.previewScale
  const previewHeightPx = activePreset.targetHeight * activePreset.previewScale
  const aspectRatioLabel = `${activePreset.targetWidth}:${activePreset.targetHeight}`

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
      </aside>

      <div className="playground-content">
        <section className="panel playground-derived-values">
          <div className="panel-header">
            <h2>Derived Values</h2>
            <p className="panel-subtitle">Live resolver outputs for the current test case.</p>
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
        </section>

        <section className="panel playground-instruments">
          <div className="panel-header">
            <h2>Unified Instrument</h2>
            <p className="panel-subtitle">Heading tape above the attitude ladder + horizon over the flight-path projection's world grid.</p>
          </div>
          <div className="hud-profile-preview" style={{ width: `${previewWidthPx}px`, height: `${previewHeightPx}px` }}>
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
                    sample={sample}
                    config={trajectoryConfig}
                    width={activePreset.targetWidth}
                    height={instrumentHeightPx}
                    profile={activePreset.hudProfile}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default UnifiedView
