import { sanitizeTelemetrySample, type TelemetrySample } from './telemetry'

export const UNKNOWN_GLOBAL_HEADING_VALUE = 65535

export type HeadingSource = 'VFR_HUD.heading' | 'ATTITUDE.yaw' | 'GLOBAL_POSITION_INT.hdg' | 'none'

export interface HeadingResolution {
  headingDeg: number | null
  source: HeadingSource
  isFallback: boolean
}

export function normalizeHeadingDegrees(input: number): number {
  const normalized = input % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function yawRadiansToHeadingDegrees(yawRad: number): number {
  const yawDeg = (yawRad * 180) / Math.PI
  return normalizeHeadingDegrees(yawDeg)
}

function readVfrHeading(sample: TelemetrySample): number | undefined {
  return sample.vfrHud?.headingDeg
}

function readAttitudeYawHeading(sample: TelemetrySample): number | undefined {
  const yawRad = sample.attitude?.yawRad

  if (yawRad === undefined) {
    return undefined
  }

  return yawRadiansToHeadingDegrees(yawRad)
}

function readGlobalPositionHeading(sample: TelemetrySample): number | undefined {
  const headingCdeg = sample.globalPositionInt?.headingCdeg

  if (headingCdeg === undefined || headingCdeg === UNKNOWN_GLOBAL_HEADING_VALUE) {
    return undefined
  }

  return normalizeHeadingDegrees(headingCdeg / 100)
}

export function resolveHeading(sampleInput: TelemetrySample): HeadingResolution {
  const sample = sanitizeTelemetrySample(sampleInput)

  const vfrHeading = readVfrHeading(sample)
  if (vfrHeading !== undefined) {
    return {
      headingDeg: normalizeHeadingDegrees(vfrHeading),
      source: 'VFR_HUD.heading',
      isFallback: false,
    }
  }

  const attitudeHeading = readAttitudeYawHeading(sample)
  if (attitudeHeading !== undefined) {
    return {
      headingDeg: attitudeHeading,
      source: 'ATTITUDE.yaw',
      isFallback: true,
    }
  }

  const globalHeading = readGlobalPositionHeading(sample)
  if (globalHeading !== undefined) {
    return {
      headingDeg: globalHeading,
      source: 'GLOBAL_POSITION_INT.hdg',
      isFallback: true,
    }
  }

  return {
    headingDeg: null,
    source: 'none',
    isFallback: false,
  }
}
