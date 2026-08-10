function formatNumber(value: number | null, precision = 1): string {
  return value === null ? 'N/A' : value.toFixed(precision)
}

export interface HudFlightStateProps {
  isStalled: boolean
  coordination: string
  headingDeg: number | null
  headingSource: string
  airSpeedMps: number | null
  airSpeedKnots: number | null
  stallSpeedMps: number | null
  climbAngleDeg: number | null
}

/**
 * Text-only instrument card: a curated slice of the resolver stack's derived
 * values (stall margin, turn coordination, resolved heading/speed, climb
 * angle) rendered as plain readouts rather than a graphic like its siblings
 * in the secondary instrument row. Takes already-resolved primitives so it
 * stays decoupled from any one page's resolver wiring.
 */
export function HudFlightState({
  isStalled,
  coordination,
  headingDeg,
  headingSource,
  airSpeedMps,
  airSpeedKnots,
  stallSpeedMps,
  climbAngleDeg,
}: HudFlightStateProps) {
  return (
    <div className="hud-flight-state" role="group" aria-label="Flight state summary">
      <p className="hud-flight-state-title">Flight State</p>
      <div className="hud-flight-state-grid">
        <div className={`hud-flight-state-stat${isStalled ? ' hud-flight-state-warn' : ''}`}>
          <span>Stall state</span>
          <strong>{isStalled ? 'BELOW STALL' : 'flying'}</strong>
        </div>
        <div className="hud-flight-state-stat">
          <span>Coordination</span>
          <strong>{coordination}</strong>
        </div>
        <div className="hud-flight-state-stat">
          <span>Resolved heading</span>
          <strong>{headingDeg === null ? 'N/A' : `${headingDeg.toFixed(1)}° (${headingSource})`}</strong>
        </div>
        <div className="hud-flight-state-stat">
          <span>Airspeed</span>
          <strong>{formatNumber(airSpeedMps)} m/s ({formatNumber(airSpeedKnots)} kt)</strong>
        </div>
        <div className="hud-flight-state-stat">
          <span>Stall speed</span>
          <strong>{formatNumber(stallSpeedMps)} m/s</strong>
        </div>
        <div className="hud-flight-state-stat">
          <span>Climb angle</span>
          <strong>{formatNumber(climbAngleDeg)}°</strong>
        </div>
      </div>
    </div>
  )
}

export default HudFlightState
