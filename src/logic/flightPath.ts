import { normalizeHeadingDegrees } from './heading'
import { sanitizeTelemetrySample, type TelemetrySample } from './telemetry'

const CM_PER_METER = 100
const KNOTS_PER_MPS = 1.943844
const STATIONARY_EPSILON_MPS = 0.01
const YAW_RATE_EPSILON_RAD_PER_SEC = 0.000001

export interface ScalarTelemetryResolution {
  groundSpeedMps: number | null
  groundSpeedKnots: number | null
  climbMps: number | null
  speedSource: 'VFR_HUD.groundspeed' | 'GLOBAL_POSITION_INT.vx_vy' | 'GPS_RAW_INT.vel' | 'none'
  climbSource: 'VFR_HUD.climb' | 'GLOBAL_POSITION_INT.vz' | 'none'
}

export interface FlightPath2dResolution {
  trackDeg: number | null
  speedMps: number | null
  source: 'GLOBAL_POSITION_INT.vx_vy' | 'GPS_RAW_INT.cog_vel' | 'none'
  isValid: boolean
}

export interface FlightPath3dResolution {
  trackDeg: number | null
  speedMps: number | null
  verticalSpeedMps: number | null
  flightPathAngleDeg: number | null
  source: 'GLOBAL_POSITION_INT.vx_vy_vz' | 'none'
  isValid: boolean
}

export interface PathPoint2d {
  tSec: number
  northM: number
  eastM: number
}

export interface PredictivePathConfig {
  horizonSec: number
  stepSec: number
}

export interface PredictivePathResolution {
  source: 'GLOBAL_POSITION_INT+ATTITUDE.yawspeed' | 'GLOBAL_POSITION_INT.linear' | 'none'
  isValid: boolean
  linear: PathPoint2d[]
  turnAware: PathPoint2d[]
}

export const DEFAULT_PREDICTIVE_PATH_CONFIG: PredictivePathConfig = {
  horizonSec: 5,
  stepSec: 0.5,
}

export function cmsToMps(valueCms: number): number {
  return valueCms / CM_PER_METER
}

export function mpsToKnots(valueMps: number): number {
  return valueMps * KNOTS_PER_MPS
}

function speedFromVxVy(vxCms: number, vyCms: number): number {
  return cmsToMps(Math.sqrt(vxCms * vxCms + vyCms * vyCms))
}

function trackFromVxVy(vxCms: number, vyCms: number): number {
  const trackDeg = (Math.atan2(vyCms, vxCms) * 180) / Math.PI
  return normalizeHeadingDegrees(trackDeg)
}

function buildTimeSteps(config: PredictivePathConfig): number[] {
  const steps = Math.floor(config.horizonSec / config.stepSec)
  const values = [0]

  for (let index = 1; index <= steps; index += 1) {
    values.push(index * config.stepSec)
  }

  return values
}

export function resolveScalarTelemetry(sampleInput: TelemetrySample): ScalarTelemetryResolution {
  const sample = sanitizeTelemetrySample(sampleInput)

  const vfrGroundSpeed = sample.vfrHud?.groundSpeedMps
  const vfrClimb = sample.vfrHud?.climbMps

  const vxCms = sample.globalPositionInt?.vxCms
  const vyCms = sample.globalPositionInt?.vyCms
  const vzCms = sample.globalPositionInt?.vzCms

  const gpsVelCms = sample.gpsRawInt?.velCms

  const derivedSpeedFromVxVy
    = vxCms !== undefined && vyCms !== undefined
      ? speedFromVxVy(vxCms, vyCms)
      : null

  const derivedSpeedFromGps = gpsVelCms !== undefined ? cmsToMps(gpsVelCms) : null

  const speedMps
    = vfrGroundSpeed
      ?? derivedSpeedFromVxVy
      ?? derivedSpeedFromGps
      ?? null

  const speedSource =
    vfrGroundSpeed !== undefined
      ? 'VFR_HUD.groundspeed'
      : derivedSpeedFromVxVy !== null
        ? 'GLOBAL_POSITION_INT.vx_vy'
        : derivedSpeedFromGps !== null
          ? 'GPS_RAW_INT.vel'
          : 'none'

  const derivedClimb = vzCms !== undefined ? -cmsToMps(vzCms) : null
  const climbMps = vfrClimb ?? derivedClimb ?? null
  const climbSource =
    vfrClimb !== undefined
      ? 'VFR_HUD.climb'
      : derivedClimb !== null
        ? 'GLOBAL_POSITION_INT.vz'
        : 'none'

  return {
    groundSpeedMps: speedMps,
    groundSpeedKnots: speedMps === null ? null : mpsToKnots(speedMps),
    climbMps,
    speedSource,
    climbSource,
  }
}

export function resolveFlightPath2d(sampleInput: TelemetrySample): FlightPath2dResolution {
  const sample = sanitizeTelemetrySample(sampleInput)
  const vxCms = sample.globalPositionInt?.vxCms
  const vyCms = sample.globalPositionInt?.vyCms

  if (vxCms !== undefined && vyCms !== undefined) {
    const speedMps = speedFromVxVy(vxCms, vyCms)

    if (speedMps < STATIONARY_EPSILON_MPS) {
      return {
        trackDeg: null,
        speedMps,
        source: 'GLOBAL_POSITION_INT.vx_vy',
        isValid: false,
      }
    }

    return {
      trackDeg: trackFromVxVy(vxCms, vyCms),
      speedMps,
      source: 'GLOBAL_POSITION_INT.vx_vy',
      isValid: true,
    }
  }

  const gpsCogCdeg = sample.gpsRawInt?.cogCdeg
  const gpsVelCms = sample.gpsRawInt?.velCms

  if (gpsCogCdeg !== undefined && gpsVelCms !== undefined) {
    const speedMps = cmsToMps(gpsVelCms)
    if (speedMps < STATIONARY_EPSILON_MPS) {
      return {
        trackDeg: null,
        speedMps,
        source: 'GPS_RAW_INT.cog_vel',
        isValid: false,
      }
    }

    return {
      trackDeg: normalizeHeadingDegrees(gpsCogCdeg / 100),
      speedMps,
      source: 'GPS_RAW_INT.cog_vel',
      isValid: true,
    }
  }

  return {
    trackDeg: null,
    speedMps: null,
    source: 'none',
    isValid: false,
  }
}

export function resolveFlightPath3d(sampleInput: TelemetrySample): FlightPath3dResolution {
  const sample = sanitizeTelemetrySample(sampleInput)
  const vxCms = sample.globalPositionInt?.vxCms
  const vyCms = sample.globalPositionInt?.vyCms
  const vzCms = sample.globalPositionInt?.vzCms

  if (vxCms === undefined || vyCms === undefined || vzCms === undefined) {
    return {
      trackDeg: null,
      speedMps: null,
      verticalSpeedMps: null,
      flightPathAngleDeg: null,
      source: 'none',
      isValid: false,
    }
  }

  const horizontalSpeedMps = speedFromVxVy(vxCms, vyCms)
  const verticalSpeedMps = -cmsToMps(vzCms)

  if (horizontalSpeedMps < STATIONARY_EPSILON_MPS && Math.abs(verticalSpeedMps) < STATIONARY_EPSILON_MPS) {
    return {
      trackDeg: null,
      speedMps: horizontalSpeedMps,
      verticalSpeedMps,
      flightPathAngleDeg: null,
      source: 'GLOBAL_POSITION_INT.vx_vy_vz',
      isValid: false,
    }
  }

  const fpaDeg = (Math.atan2(verticalSpeedMps, horizontalSpeedMps) * 180) / Math.PI

  return {
    trackDeg: horizontalSpeedMps < STATIONARY_EPSILON_MPS ? null : trackFromVxVy(vxCms, vyCms),
    speedMps: horizontalSpeedMps,
    verticalSpeedMps,
    flightPathAngleDeg: fpaDeg,
    source: 'GLOBAL_POSITION_INT.vx_vy_vz',
    isValid: true,
  }
}

export function resolvePredictivePath(
  sampleInput: TelemetrySample,
  config: PredictivePathConfig = DEFAULT_PREDICTIVE_PATH_CONFIG,
): PredictivePathResolution {
  const sample = sanitizeTelemetrySample(sampleInput)
  const vxCms = sample.globalPositionInt?.vxCms
  const vyCms = sample.globalPositionInt?.vyCms

  if (vxCms === undefined || vyCms === undefined) {
    return {
      source: 'none',
      isValid: false,
      linear: [],
      turnAware: [],
    }
  }

  const vxMps = cmsToMps(vxCms)
  const vyMps = cmsToMps(vyCms)
  const speedMps = Math.sqrt(vxMps * vxMps + vyMps * vyMps)
  if (speedMps < STATIONARY_EPSILON_MPS) {
    return {
      source: 'GLOBAL_POSITION_INT.linear',
      isValid: false,
      linear: [],
      turnAware: [],
    }
  }

  const yawRateRadPerSec = sample.attitude?.yawSpeedRadPerSec
  const hasYawRate = yawRateRadPerSec !== undefined && Math.abs(yawRateRadPerSec) >= YAW_RATE_EPSILON_RAD_PER_SEC
  const theta0 = Math.atan2(vyMps, vxMps)
  const timeSteps = buildTimeSteps(config)

  const linear = timeSteps.map((tSec) => ({
    tSec,
    northM: vxMps * tSec,
    eastM: vyMps * tSec,
  }))

  const turnAware = timeSteps.map((tSec) => {
    if (!hasYawRate || yawRateRadPerSec === undefined) {
      return {
        tSec,
        northM: vxMps * tSec,
        eastM: vyMps * tSec,
      }
    }

    const northM = (speedMps / yawRateRadPerSec) * (Math.sin(theta0 + yawRateRadPerSec * tSec) - Math.sin(theta0))
    const eastM = -(speedMps / yawRateRadPerSec) * (Math.cos(theta0 + yawRateRadPerSec * tSec) - Math.cos(theta0))

    return {
      tSec,
      northM,
      eastM,
    }
  })

  return {
    source: hasYawRate ? 'GLOBAL_POSITION_INT+ATTITUDE.yawspeed' : 'GLOBAL_POSITION_INT.linear',
    isValid: true,
    linear,
    turnAware,
  }
}
