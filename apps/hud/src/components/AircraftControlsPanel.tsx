import type { AircraftControls } from '../hooks/useAircraftControls'
import { ParameterSlider } from './ParameterSlider'

/** Sidebar sliders for the playground-style pages — see useAircraftControls. */
export function AircraftControlsPanel({
  rollDeg,
  setRollDeg,
  pitchDeg,
  setPitchDeg,
  pitchRateDps,
  setPitchRateDps,
  yawRateDps,
  setYawRateDps,
  airSpeedMps,
  setAirSpeedMps,
  flightPathAngleDeg,
  setFlightPathAngleDeg,
  headingDeg,
  setHeadingDeg,
  stallSpeedMps,
  setStallSpeedMps,
}: AircraftControls) {
  return (
    <>
      <section className="panel playground-control-panel">
        <div className="panel-header">
          <h2>Airframe attitude</h2>
          <p className="panel-subtitle">Orientation and body rates. Yaw rate turns; pitch rate pulls.</p>
        </div>
        <div className="playground-controls">
          <ParameterSlider label="Roll" unit="°" min={-90} max={90} step={1} value={rollDeg} onChange={setRollDeg} />
          <ParameterSlider label="Pitch" unit="°" min={-90} max={90} step={1} value={pitchDeg} onChange={setPitchDeg} />
          <ParameterSlider label="Pitch rate (q)" unit=" °/s" min={-30} max={30} step={0.5} value={pitchRateDps} onChange={setPitchRateDps} precision={1} />
          <ParameterSlider label="Yaw rate (r)" unit=" °/s" min={-60} max={60} step={0.5} value={yawRateDps} onChange={setYawRateDps} precision={1} />
        </div>
      </section>

      <section className="panel playground-control-panel">
        <div className="panel-header">
          <h2>Velocity vector &amp; speed</h2>
          <p className="panel-subtitle">Flight path is independent of pitch attitude.</p>
        </div>
        <div className="playground-controls">
          <ParameterSlider label="Airspeed" unit=" m/s" min={0} max={60} step={0.5} value={airSpeedMps} onChange={setAirSpeedMps} precision={1} />
          <ParameterSlider label="Flight-path angle" unit="°" min={-30} max={30} step={0.5} value={flightPathAngleDeg} onChange={setFlightPathAngleDeg} precision={1} />
          <ParameterSlider label="Heading" unit="°" min={-180} max={180} step={1} value={headingDeg} onChange={setHeadingDeg} />
          <ParameterSlider label="Stall speed" unit=" m/s" min={0} max={30} step={0.5} value={stallSpeedMps} onChange={setStallSpeedMps} precision={1} />
        </div>
      </section>
    </>
  )
}

export default AircraftControlsPanel
