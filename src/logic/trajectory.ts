import { climbAngleRateFromBodyRates, headingRateFromBodyRates, resolveAttitude } from './attitude'
import { resolveFlightPath2d, resolveScalarTelemetry } from './flightPath'
import { resolveHeading } from './heading'
import type { TelemetrySample } from './telemetry'

const GRAVITY_MPS2 = 9.81

export interface TrajectoryPoint {
  x: number
  y: number
  tSec: number
}

/**
 * A predicted position expressed in a nose-relative frame (straight-ahead at
 * t=0), suitable for a forward-looking perspective projection:
 *   forwardM  — distance ahead along the initial nose axis (depth into screen)
 *   lateralM  — signed sideways offset, +right, from turn + wind drift
 *   verticalM — signed vertical offset, +up, from climb
 */
export interface ForwardPathPoint {
  forwardM: number
  lateralM: number
  verticalM: number
  tSec: number
}

export interface TrajectoryResolution {
  points: TrajectoryPoint[]
  forwardPoints: ForwardPathPoint[]
  speedMps: number
  airSpeedMps: number
  stallSpeedMps: number
  turnRateRadPerSec: number
  /** Coordinated-turn rate g·tan(φ)/V for the current bank — reference for slip/skid. */
  coordinatedTurnRateRadPerSec: number
  /** Rate the flight-path (climb) angle bends over the horizon, from body rates. */
  climbAngleRateRadPerSec: number
  verticalRateMps: number
  /** Initial flight-path angle (deg): from vertical speed when known, else pitch. */
  flightPathAngleDeg: number
  headingDeg: number | null
  trackDeg: number | null
  headingTrackDeltaDeg: number
  driftDeg: number
  windDriftMps: number
  isStalled: boolean
}

export interface TrajectoryConfig {
  stallSpeedMps: number
  horizonSec: number
  stepSec: number
  headingTrackBlend: number
  windOffsetGain: number
}

export const DEFAULT_TRAJECTORY_CONFIG: TrajectoryConfig = {
  stallSpeedMps: 14,
  horizonSec: 5,
  stepSec: 0.25,
  headingTrackBlend: 0.45,
  windOffsetGain: 0.32,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function degreesToRadians(valueDeg: number): number {
  return (valueDeg * Math.PI) / 180
}

function shortestAngleRadians(fromRad: number, toRad: number): number {
  const raw = toRad - fromRad
  if (raw > Math.PI) {
    return raw - 2 * Math.PI
  }
  if (raw < -Math.PI) {
    return raw + 2 * Math.PI
  }
  return raw
}

function blendAnglesRadians(primaryRad: number, secondaryRad: number, blend: number): number {
  const delta = shortestAngleRadians(primaryRad, secondaryRad)
  return primaryRad + delta * blend
}

export function resolvePredictiveTrajectory(
  sample: TelemetrySample,
  config: TrajectoryConfig = DEFAULT_TRAJECTORY_CONFIG,
): TrajectoryResolution {
  const scalar = resolveScalarTelemetry(sample)
  const attitude = resolveAttitude(sample)
  const heading = resolveHeading(sample)
  const track = resolveFlightPath2d(sample)

  const speedMps = scalar.groundSpeedMps ?? 0
  // Air-relative physics (stall, forward reach, climb geometry, turn rate) key
  // off airspeed; groundspeed stays for the ground-track/wind-drift term. When
  // airspeed is absent we fall back to groundspeed so still-air callers and the
  // existing replay frames are unchanged.
  const airSpeedMps = scalar.airSpeedMps ?? speedMps
  const pitchDeg = attitude.pitchDeg ?? 0
  const rollDeg = attitude.rollDeg ?? 0
  const pitchRad = degreesToRadians(pitchDeg)
  const rollRad = degreesToRadians(rollDeg)
  const headingRad = degreesToRadians(heading.headingDeg ?? 0)
  const trackRad = degreesToRadians(track.trackDeg ?? heading.headingDeg ?? 0)
  const driftDeg = shortestAngleRadians(headingRad, trackRad) * (180 / Math.PI)

  const stallSpeedMps = config.stallSpeedMps
  const isStalled = airSpeedMps < stallSpeedMps
  const effectiveForwardSpeed = Math.max(0, airSpeedMps - stallSpeedMps)
  const headingBlend = clamp((airSpeedMps - stallSpeedMps) / Math.max(1, stallSpeedMps), 0, 1)
  const worldDirectionRad = blendAnglesRadians(headingRad, trackRad, Math.min(1, config.headingTrackBlend + headingBlend * 0.35))
  const windDriftMps = clamp(speedMps * Math.sin(shortestAngleRadians(headingRad, trackRad)) * config.windOffsetGain, -8, 8)

  // --- Rotation state -------------------------------------------------------
  // Body angular rates (rad/s) come straight from ATTITUDE (pitchspeed q,
  // yawspeed r) — a single-sample, stateless read, portable to firmware. The
  // earth-frame turn rate is the standard Euler kinematic transform: when
  // banked, pitch rate feeds heading change (the coordinated-turn coupling), so
  // we do NOT add a bank-derived rate on top of the measured yaw rate.
  const pitchRateRadPerSec = sample.attitude?.pitchSpeedRadPerSec ?? 0
  const yawRateRadPerSec = sample.attitude?.yawSpeedRadPerSec ?? 0
  const hasBodyRates
    = sample.attitude?.pitchSpeedRadPerSec !== undefined
      || sample.attitude?.yawSpeedRadPerSec !== undefined

  // Coordinated-turn rate for the current bank: g·tan(φ)/V. Used as the turn-rate
  // fallback when no body rates exist, and always surfaced as a reference the
  // caller can compare against the actual rate to read slip/skid coordination.
  const coordinatedTurnRateRadPerSec = clamp(
    (GRAVITY_MPS2 * Math.tan(rollRad)) / Math.max(airSpeedMps, stallSpeedMps),
    -1.8,
    1.8,
  )

  // Earth-frame turn/climb rates from body rates via the shared Euler kinematics
  // (same transform resolvePredictivePath uses, so both read yawspeed as body r).
  const turnRateRadPerSec = hasBodyRates
    ? clamp(headingRateFromBodyRates(rollRad, pitchRad, pitchRateRadPerSec, yawRateRadPerSec), -1.8, 1.8)
    : coordinatedTurnRateRadPerSec

  const climbAngleRateRadPerSec = hasBodyRates
    ? climbAngleRateFromBodyRates(rollRad, pitchRateRadPerSec, yawRateRadPerSec)
    : 0

  // Initial flight-path angle γ₀. Prefer the VELOCITY VECTOR: measured vertical
  // speed gives the true climb angle asin(vs/V), independent of pitch attitude —
  // this is what lets a level coordinated turn read as level despite nose-up
  // pitch. Falls back to the pitch proxy (AoA-limited) when no vertical speed is
  // known. This is the seam a future velocity-vector flight-path marker plugs into.
  const verticalSpeedMps = scalar.climbMps
  const flightPathAngle0Rad = verticalSpeedMps !== null && airSpeedMps > 0.01
    ? Math.asin(clamp(verticalSpeedMps / airSpeedMps, -1, 1))
    : pitchRad
  const verticalRateMps = airSpeedMps * Math.sin(flightPathAngle0Rad)

  const steps = Math.max(1, Math.floor(config.horizonSec / config.stepSec))
  const points: TrajectoryPoint[] = [{ x: 0, y: 0, tSec: 0 }]
  const forwardPoints: ForwardPathPoint[] = [{ forwardM: 0, lateralM: 0, verticalM: 0, tSec: 0 }]

  let pathDirectionRad = worldDirectionRad
  let x = 0
  let y = 0

  // Nose-relative integration for the forward perspective view: heading starts
  // at 0 (straight ahead) so forward/lateral are measured off the current nose.
  // The flight-path angle γ starts at γ₀ and bends at the climb-angle rate, so
  // the corridor curves in pitch as well as azimuth. The forward pace stays the
  // stall-referenced speed (keeps the below-stall collapse cue and the tuned
  // camera scale); the velocity vector's DIRECTION (γ, ψ) is what carries the
  // corrected coordinated-turn geometry.
  let relHeadingRad = 0
  let gammaRad = flightPathAngle0Rad
  let forwardM = 0
  let lateralM = 0
  let verticalM = 0

  const MAX_GAMMA_RAD = 1.047 // ±60° — keep the integrated climb angle sane

  for (let index = 1; index <= steps; index += 1) {
    const tSec = index * config.stepSec
    pathDirectionRad += turnRateRadPerSec * config.stepSec
    relHeadingRad += turnRateRadPerSec * config.stepSec
    gammaRad = clamp(gammaRad + climbAngleRateRadPerSec * config.stepSec, -MAX_GAMMA_RAD, MAX_GAMMA_RAD)

    const paceStep = effectiveForwardSpeed * config.stepSec
    const horizontalStep = Math.cos(gammaRad) * paceStep
    const climbStep = Math.sin(gammaRad) * paceStep

    const lateralStep = Math.sin(pathDirectionRad) * horizontalStep + windDriftMps * config.stepSec
    const forwardStepY = Math.cos(pathDirectionRad) * horizontalStep

    x += lateralStep
    y += forwardStepY + climbStep

    points.push({ x, y, tSec })

    forwardM += Math.cos(relHeadingRad) * horizontalStep
    lateralM += Math.sin(relHeadingRad) * horizontalStep + windDriftMps * config.stepSec
    verticalM += climbStep
    forwardPoints.push({ forwardM, lateralM, verticalM, tSec })
  }

  return {
    points,
    forwardPoints,
    speedMps,
    airSpeedMps,
    stallSpeedMps,
    turnRateRadPerSec,
    coordinatedTurnRateRadPerSec,
    climbAngleRateRadPerSec,
    verticalRateMps,
    flightPathAngleDeg: (flightPathAngle0Rad * 180) / Math.PI,
    headingDeg: heading.headingDeg,
    trackDeg: track.trackDeg,
    headingTrackDeltaDeg: driftDeg,
    driftDeg,
    windDriftMps,
    isStalled,
  }
}
