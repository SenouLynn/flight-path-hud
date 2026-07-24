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

function PlaygroundView() {
  const [rollDeg, setRollDeg] = useState(0)
  const [pitchDeg, setPitchDeg] = useState(0)
  const [headingDeg, setHeadingDeg] = useState(90)
  const [airSpeedMps, setAirSpeedMps] = useState(22)
  const [stallSpeedMps, setStallSpeedMps] = useState(DEFAULT_TRAJECTORY_CONFIG.stallSpeedMps)

  // Build one real, sanitized sample and run it through the exact production
  // resolver stack — this is the visual counterpart to the logic unit tests.
  const sample = useMemo(
    () => buildStaticSample({ rollDeg, pitchDeg, headingDeg, airSpeedMps }),
    [rollDeg, pitchDeg, headingDeg, airSpeedMps],
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

  return (
    <>
      <section className="header">
        <p className="eyebrow">Static visual validation</p>
        <h1>HUD Parameter Playground</h1>
        <p className="intro">
          A single frozen moment: dial roll, pitch, heading, airspeed, and stall speed to drive the
          instruments directly. Inputs are packed into a real MAVLink-style sample and resolved by the
          same production logic as the live feed, so what you see is a visual check of that math.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Inputs</h2>
          <p className="panel-subtitle">Parametrized MAVLink attitude + airspeed. Global positioning is intentionally excluded for a static instant.</p>
        </div>
        <div className="playground-controls">
          <ParameterSlider label="Roll" unit="°" min={-90} max={90} step={1} value={rollDeg} onChange={setRollDeg} />
          <ParameterSlider label="Pitch" unit="°" min={-90} max={90} step={1} value={pitchDeg} onChange={setPitchDeg} />
          <ParameterSlider label="Heading" unit="°" min={0} max={359} step={1} value={headingDeg} onChange={setHeadingDeg} />
          <ParameterSlider label="Airspeed" unit=" m/s" min={0} max={60} step={0.5} value={airSpeedMps} onChange={setAirSpeedMps} precision={1} />
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
          <p className="panel-subtitle">Live resolver outputs for the current inputs — a running mirror of a single test case.</p>
        </div>
        <div className="playground-readout">
          <div className={`readout-stat${trajectory.isStalled ? ' readout-stat-warn' : ''}`}>
            <span>Stall state</span>
            <strong>{trajectory.isStalled ? 'BELOW STALL' : 'flying'}</strong>
          </div>
          <div className="readout-stat"><span>Resolved pitch</span><strong>{formatNumber(attitude.pitchDeg)}°</strong></div>
          <div className="readout-stat"><span>Resolved roll</span><strong>{formatNumber(attitude.rollDeg)}°</strong></div>
          <div className="readout-stat"><span>Resolved heading</span><strong>{formatNumber(heading.headingDeg)}° ({heading.source})</strong></div>
          <div className="readout-stat"><span>Airspeed</span><strong>{formatNumber(scalar.airSpeedMps)} m/s ({formatNumber(scalar.airSpeedKnots, 1)} kt)</strong></div>
          <div className="readout-stat"><span>Ground speed</span><strong>{formatNumber(scalar.groundSpeedMps)} m/s</strong></div>
          <div className="readout-stat"><span>Stall speed</span><strong>{formatNumber(trajectory.stallSpeedMps)} m/s</strong></div>
          <div className="readout-stat"><span>Turn rate</span><strong>{formatNumber(trajectory.turnRateRadPerSec, 3)} rad/s</strong></div>
          <div className="readout-stat"><span>Vertical rate</span><strong>{formatNumber(trajectory.verticalRateMps)} m/s</strong></div>
          <div className="readout-stat"><span>Drift</span><strong>{formatNumber(trajectory.driftDeg)}°</strong></div>
        </div>
      </section>
    </>
  )
}

export default PlaygroundView
