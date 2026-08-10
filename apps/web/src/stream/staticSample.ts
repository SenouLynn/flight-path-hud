import { sanitizeTelemetrySample, type TelemetrySample } from '@flight-path-hud/hud-ui'

/**
 * Parameters an operator dials in the static playground. This is a single
 * "moment in time" — no positioning, no clock.
 *
 * Two conceptually distinct groups are exposed, matching how a real HUD is
 * driven:
 *   • Airframe attitude — how the aircraft is oriented and rotating (roll,
 *     pitch, and the body pitch/yaw rates). These bank/pitch the display and,
 *     via the Euler kinematics, curve the predicted path.
 *   • Velocity vector — where the aircraft is actually going (airspeed, flight-
 *     path angle, heading/track). Crucially the flight-path angle is separate
 *     from pitch: a level coordinated turn is nose-up (pitch) but level (FPA 0).
 *
 * With no ground track (no GPS) course-over-ground collapses onto heading, so
 * lateral wind drift is zero by construction.
 */
export interface StaticSampleParams {
  rollDeg: number
  pitchDeg: number
  headingDeg: number
  airSpeedMps: number
  /** Flight-path angle (deg): the velocity vector's climb angle, independent of pitch. */
  flightPathAngleDeg: number
  /** Body pitch rate q (deg/s) — "pull". */
  pitchRateDegPerSec: number
  /** Body yaw rate r (deg/s) — "rudder/turn". */
  yawRateDegPerSec: number
}

function degreesToRadians(valueDeg: number): number {
  return (valueDeg * Math.PI) / 180
}

/**
 * Build a real, sanitized TelemetrySample from playground parameters so the
 * static view flows through the exact same resolver stack as the live feed
 * (resolveAttitude / resolveHeading / resolveScalarTelemetry / trajectory).
 * That is what makes the playground a visual validation of the production
 * logic rather than a parallel mock.
 *
 * The flight-path angle is expressed as vertical speed (`climbMps = V·sin(γ)`,
 * a standard VFR_HUD field) so the trajectory resolver derives γ from the
 * velocity vector exactly as it would from real telemetry — pitch attitude is
 * left to drive only the HUD's display tilt. groundSpeedMps mirrors airspeed
 * (still-air assumption for a static instant).
 */
export function buildStaticSample(params: StaticSampleParams): TelemetrySample {
  const {
    rollDeg,
    pitchDeg,
    headingDeg,
    airSpeedMps,
    flightPathAngleDeg,
    pitchRateDegPerSec,
    yawRateDegPerSec,
  } = params

  const climbMps = airSpeedMps * Math.sin(degreesToRadians(flightPathAngleDeg))

  return sanitizeTelemetrySample({
    timestampMs: 0,
    attitude: {
      rollRad: degreesToRadians(rollDeg),
      pitchRad: degreesToRadians(pitchDeg),
      yawRad: degreesToRadians(headingDeg),
      pitchSpeedRadPerSec: degreesToRadians(pitchRateDegPerSec),
      yawSpeedRadPerSec: degreesToRadians(yawRateDegPerSec),
    },
    vfrHud: {
      headingDeg,
      airSpeedMps,
      groundSpeedMps: airSpeedMps,
      climbMps,
    },
  })
}
