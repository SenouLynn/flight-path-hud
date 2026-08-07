import { useMemo } from 'react'
import { AircraftControlsPanel } from '../components/AircraftControlsPanel'
import { HudFlightState } from '../components/HudFlightState'
import { HudOrientationIndicator } from '../components/HudOrientationIndicator'
import { HudPrimaryFlightDisplay } from '../components/HudPrimaryFlightDisplay'
import { HudPredictiveTrajectory } from '../components/HudPredictiveTrajectory'
import { useAircraftControls } from '../hooks/useAircraftControls'
import { resolveAttitude } from '../logic/attitude'
import { resolveScalarTelemetry } from '../logic/flightPath'
import { resolveHeading } from '../logic/heading'
import { DEFAULT_TRAJECTORY_CONFIG, resolveCoordinationLabel, resolvePredictiveTrajectory } from '../logic/trajectory'
import { buildStaticSample } from '../stream/staticSample'

const RAD_TO_DEG = 180 / Math.PI

function formatNumber(value: number | null, precision = 2): string {
  return value === null ? 'N/A' : value.toFixed(precision)
}

function PlaygroundView() {
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

  // Build one real, sanitized sample and run it through the exact production
  // resolver stack — this is the visual counterpart to the logic unit tests.
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
  const yawDeg = sample.attitude?.yawRad === undefined ? null : sample.attitude.yawRad * RAD_TO_DEG

  const turnRateDps = trajectory.turnRateRadPerSec * RAD_TO_DEG
  const coordinatedDps = trajectory.coordinatedTurnRateRadPerSec * RAD_TO_DEG
  const coordination = resolveCoordinationLabel(trajectory.turnRateRadPerSec, trajectory.coordinatedTurnRateRadPerSec)

  return (
    <div className="playground-layout">
      <aside className="playground-sidebar" aria-label="Playground controls">
        <section className="header playground-header">
          <p className="eyebrow">Static visual validation</p>
          <p className="intro">
            Adjust the aircraft state and velocity vector while keeping the full instrument display in view.
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
            <h2>HUD Instruments</h2>
            <p className="panel-subtitle">Primary flight display, 3D orientation, and predictive trajectory driven by the controls.</p>
          </div>
          <div className="hud-fused-shell">
            <div className="hud-main-row">
              <HudPrimaryFlightDisplay
                headingDeg={heading.headingDeg}
                pitchDeg={attitude.pitchDeg}
                rollDeg={attitude.rollDeg}
              />
            </div>
            <div className="hud-secondary-grid">
              <div className="hud-secondary-card">
                <HudOrientationIndicator
                  rollDeg={attitude.rollDeg}
                  pitchDeg={attitude.pitchDeg}
                  yawDeg={yawDeg}
                  width={620}
                  height={360}
                />
              </div>
              <div className="hud-secondary-card">
                <HudPredictiveTrajectory sample={sample} config={trajectoryConfig} width={620} height={360} />
              </div>
              <div className="hud-secondary-card">
                <HudFlightState
                  isStalled={trajectory.isStalled}
                  coordination={coordination}
                  headingDeg={heading.headingDeg}
                  headingSource={heading.source}
                  airSpeedMps={scalar.airSpeedMps}
                  airSpeedKnots={scalar.airSpeedKnots}
                  stallSpeedMps={trajectory.stallSpeedMps}
                  climbAngleDeg={trajectory.flightPathAngleDeg}
                />
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}

export default PlaygroundView
