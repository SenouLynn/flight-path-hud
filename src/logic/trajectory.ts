import { resolveAttitude } from './attitude'
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
  verticalRateMps: number
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
  const yawRateRadPerSec = sample.attitude?.yawSpeedRadPerSec ?? 0

  const stallSpeedMps = config.stallSpeedMps
  const isStalled = airSpeedMps < stallSpeedMps
  const effectiveForwardSpeed = Math.max(0, airSpeedMps - stallSpeedMps)
  const headingBlend = clamp((airSpeedMps - stallSpeedMps) / Math.max(1, stallSpeedMps), 0, 1)
  const worldDirectionRad = blendAnglesRadians(headingRad, trackRad, Math.min(1, config.headingTrackBlend + headingBlend * 0.35))
  const windDriftMps = clamp(speedMps * Math.sin(shortestAngleRadians(headingRad, trackRad)) * config.windOffsetGain, -8, 8)

  const bankTurnRate = (GRAVITY_MPS2 * Math.tan(rollRad)) / Math.max(airSpeedMps, stallSpeedMps)
  const turnRateRadPerSec = clamp(yawRateRadPerSec + bankTurnRate, -1.8, 1.8)
  const verticalRateMps = (airSpeedMps * Math.sin(pitchRad)) + (scalar.climbMps ?? 0)

  const steps = Math.max(1, Math.floor(config.horizonSec / config.stepSec))
  const points: TrajectoryPoint[] = [{ x: 0, y: 0, tSec: 0 }]
  const forwardPoints: ForwardPathPoint[] = [{ forwardM: 0, lateralM: 0, verticalM: 0, tSec: 0 }]

  let pathDirectionRad = worldDirectionRad
  let x = 0
  let y = 0

  // Nose-relative integration for the forward perspective view: heading starts
  // at 0 (straight ahead) so forward/lateral are measured off the current nose.
  let relHeadingRad = 0
  let forwardM = 0
  let lateralM = 0

  for (let index = 1; index <= steps; index += 1) {
    const tSec = index * config.stepSec
    pathDirectionRad += turnRateRadPerSec * config.stepSec
    relHeadingRad += turnRateRadPerSec * config.stepSec

    const forwardStep = effectiveForwardSpeed * config.stepSec
    const lateralStep = Math.sin(pathDirectionRad) * forwardStep + windDriftMps * config.stepSec
    const forwardStepY = Math.cos(pathDirectionRad) * forwardStep
    const climbStep = verticalRateMps * config.stepSec

    x += lateralStep
    y += forwardStepY + climbStep

    points.push({ x, y, tSec })

    forwardM += Math.cos(relHeadingRad) * forwardStep
    lateralM += Math.sin(relHeadingRad) * forwardStep + windDriftMps * config.stepSec
    forwardPoints.push({ forwardM, lateralM, verticalM: verticalRateMps * tSec, tSec })
  }

  return {
    points,
    forwardPoints,
    speedMps,
    airSpeedMps,
    stallSpeedMps,
    turnRateRadPerSec,
    verticalRateMps,
    headingDeg: heading.headingDeg,
    trackDeg: track.trackDeg,
    headingTrackDeltaDeg: driftDeg,
    driftDeg,
    windDriftMps,
    isStalled,
  }
}
