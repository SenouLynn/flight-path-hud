import { sanitizeTelemetrySample, type TelemetrySample } from '../logic/telemetry'

/**
 * Parameters an operator dials in the static playground. This is a single
 * "moment in time" — no positioning, no velocity vector, no clock. Heading and
 * yaw are one value here: with no ground track (no GPS) course-over-ground
 * collapses onto heading, so drift is zero by construction.
 */
export interface StaticSampleParams {
  rollDeg: number
  pitchDeg: number
  headingDeg: number
  airSpeedMps: number
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
 * groundSpeedMps mirrors airspeed (still-air assumption for a static instant);
 * the trajectory's air-relative physics read airspeed, and the ground-track/
 * wind-drift term reads groundspeed — with track == heading the drift is zero.
 */
export function buildStaticSample(params: StaticSampleParams): TelemetrySample {
  const { rollDeg, pitchDeg, headingDeg, airSpeedMps } = params

  return sanitizeTelemetrySample({
    timestampMs: 0,
    attitude: {
      rollRad: degreesToRadians(rollDeg),
      pitchRad: degreesToRadians(pitchDeg),
      yawRad: degreesToRadians(headingDeg),
      yawSpeedRadPerSec: 0,
    },
    vfrHud: {
      headingDeg,
      airSpeedMps,
      groundSpeedMps: airSpeedMps,
      climbMps: 0,
    },
  })
}
