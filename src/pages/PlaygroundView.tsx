import { useMemo, useState } from 'react'
import { HudOrientationIndicator } from '../components/HudOrientationIndicator'
import { HudPrimaryFlightDisplay } from '../components/HudPrimaryFlightDisplay'
import { HudPredictiveTrajectory } from '../components/HudPredictiveTrajectory'
import { ParameterSlider } from '../components/ParameterSlider'
import { resolveAttitude } from '../logic/attitude'
import { resolveScalarTelemetry } from '../logic/flightPath'
import { resolveHeading } from '../logic/heading'
import { DEFAULT_TRAJECTORY_CONFIG, resolvePredictiveTrajectory } from '../logic/trajectory'
import { buildStaticSample } from '../stream/staticSample'

const RAD_TO_DEG = 180 / Math.PI

function formatNumber(value: number | null, precision = 2): string {
  return value === null ? 'N/A' : value.toFixed(precision)
}

/**
 * Read turn coordination from the kinematics alone (no sideslip field): compare
 * the actual turn rate against the coordinated-turn rate the current bank
 * implies. Under-turning for the bank reads as a slip, over-turning as a skid.
 */
function coordinationLabel(actualRadPerSec: number, coordinatedRadPerSec: number): string {
  if (Math.abs(coordinatedRadPerSec) < 0.02) {
    return Math.abs(actualRadPerSec) < 0.02 ? 'wings level' : 'flat turn (rudder only)'
  }
  const tolerance = Math.max(0.03, Math.abs(coordinatedRadPerSec) * 0.15)
  if (Math.abs(actualRadPerSec - coordinatedRadPerSec) <= tolerance) {
    return 'coordinated'
  }
  return Math.abs(actualRadPerSec) < Math.abs(coordinatedRadPerSec) ? 'slipping' : 'skidding'
}

function PlaygroundView() {
  // Airframe attitude — how the aircraft is oriented and rotating.
  const [rollDeg, setRollDeg] = useState(0)
  const [pitchDeg, setPitchDeg] = useState(0)
  const [pitchRateDps, setPitchRateDps] = useState(0)
  const [yawRateDps, setYawRateDps] = useState(0)

  // Velocity vector — where the aircraft is actually going.
  const [airSpeedMps, setAirSpeedMps] = useState(22)
  const [flightPathAngleDeg, setFlightPathAngleDeg] = useState(0)
  const [headingDeg, setHeadingDeg] = useState(90)
  const [stallSpeedMps, setStallSpeedMps] = useState(DEFAULT_TRAJECTORY_CONFIG.stallSpeedMps)

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
  const coordination = coordinationLabel(trajectory.turnRateRadPerSec, trajectory.coordinatedTurnRateRadPerSec)

  return (
    <>
      <section className="header">
        <p className="eyebrow">Static visual validation</p>
        <h1>HUD Parameter Playground</h1>
        <p className="intro">
          A single frozen moment. The <strong>airframe</strong> inputs (attitude + body rates) bank and
          pitch the display and curve the predicted path via the Euler turn kinematics; the{' '}
          <strong>velocity vector</strong> inputs (airspeed, flight-path angle, heading) say where the
          aircraft is actually going. Flight-path angle is deliberately separate from pitch — a level
          coordinated turn is nose-up but flat. Everything is packed into a real MAVLink-style sample and
          resolved by the same production logic as the live feed.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Airframe attitude</h2>
          <p className="panel-subtitle">Orientation and body angular rates (ATTITUDE roll/pitch + pitchspeed/yawspeed). Add yaw rate to turn; add pitch rate to pull.</p>
        </div>
        <div className="playground-controls">
          <ParameterSlider label="Roll" unit="°" min={-90} max={90} step={1} value={rollDeg} onChange={setRollDeg} />
          <ParameterSlider label="Pitch" unit="°" min={-90} max={90} step={1} value={pitchDeg} onChange={setPitchDeg} />
          <ParameterSlider label="Pitch rate (q)" unit=" °/s" min={-30} max={30} step={0.5} value={pitchRateDps} onChange={setPitchRateDps} precision={1} />
          <ParameterSlider label="Yaw rate (r)" unit=" °/s" min={-60} max={60} step={0.5} value={yawRateDps} onChange={setYawRateDps} precision={1} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Velocity vector &amp; speed</h2>
          <p className="panel-subtitle">Where the aircraft is going. Flight-path angle drives the path's climb/descent independent of pitch attitude. Global positioning is excluded for a static instant.</p>
        </div>
        <div className="playground-controls">
          <ParameterSlider label="Airspeed" unit=" m/s" min={0} max={60} step={0.5} value={airSpeedMps} onChange={setAirSpeedMps} precision={1} />
          <ParameterSlider label="Flight-path angle" unit="°" min={-30} max={30} step={0.5} value={flightPathAngleDeg} onChange={setFlightPathAngleDeg} precision={1} />
          <ParameterSlider label="Heading" unit="°" min={0} max={359} step={1} value={headingDeg} onChange={setHeadingDeg} />
          <ParameterSlider label="Stall speed" unit=" m/s" min={0} max={30} step={0.5} value={stallSpeedMps} onChange={setStallSpeedMps} precision={1} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>HUD Instruments</h2>
          <p className="panel-subtitle">Primary flight display, 3D orientation, and predictive trajectory driven by the inputs above.</p>
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
                height={480}
              />
            </div>
            <div className="hud-secondary-card">
              <HudPredictiveTrajectory sample={sample} config={trajectoryConfig} width={620} height={480} />
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Derived Values</h2>
          <p className="panel-subtitle">Live resolver outputs — a running mirror of a single test case. Turn rate vs the coordinated reference reads slip/skid without any sideslip field.</p>
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
    </>
  )
}

export default PlaygroundView
