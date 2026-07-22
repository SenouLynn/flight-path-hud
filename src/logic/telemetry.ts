export interface AttitudeSample {
  rollRad?: number
  pitchRad?: number
  yawRad?: number
  yawSpeedRadPerSec?: number
}

export interface VfrHudSample {
  headingDeg?: number
  groundSpeedMps?: number
  climbMps?: number
}

export interface GlobalPositionIntSample {
  headingCdeg?: number
  vxCms?: number
  vyCms?: number
  vzCms?: number
}

export interface GpsRawIntSample {
  cogCdeg?: number
  velCms?: number
}

export interface TelemetrySample {
  timestampMs: number
  attitude?: AttitudeSample
  vfrHud?: VfrHudSample
  globalPositionInt?: GlobalPositionIntSample
  gpsRawInt?: GpsRawIntSample
}

function toFiniteNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return undefined
  }

  return value
}

function sanitizeAttitude(input: AttitudeSample | undefined): AttitudeSample | undefined {
  if (!input) {
    return undefined
  }

  const sample: AttitudeSample = {
    rollRad: toFiniteNumber(input.rollRad),
    pitchRad: toFiniteNumber(input.pitchRad),
    yawRad: toFiniteNumber(input.yawRad),
    yawSpeedRadPerSec: toFiniteNumber(input.yawSpeedRadPerSec),
  }

  if (
    sample.rollRad === undefined
    && sample.pitchRad === undefined
    && sample.yawRad === undefined
    && sample.yawSpeedRadPerSec === undefined
  ) {
    return undefined
  }

  return sample
}

function sanitizeVfrHud(input: VfrHudSample | undefined): VfrHudSample | undefined {
  if (!input) {
    return undefined
  }

  const sample: VfrHudSample = {
    headingDeg: toFiniteNumber(input.headingDeg),
    groundSpeedMps: toFiniteNumber(input.groundSpeedMps),
    climbMps: toFiniteNumber(input.climbMps),
  }

  if (sample.headingDeg === undefined && sample.groundSpeedMps === undefined && sample.climbMps === undefined) {
    return undefined
  }

  return sample
}

function sanitizeGlobalPositionInt(
  input: GlobalPositionIntSample | undefined,
): GlobalPositionIntSample | undefined {
  if (!input) {
    return undefined
  }

  const sample: GlobalPositionIntSample = {
    headingCdeg: toFiniteNumber(input.headingCdeg),
    vxCms: toFiniteNumber(input.vxCms),
    vyCms: toFiniteNumber(input.vyCms),
    vzCms: toFiniteNumber(input.vzCms),
  }

  if (
    sample.headingCdeg === undefined
    && sample.vxCms === undefined
    && sample.vyCms === undefined
    && sample.vzCms === undefined
  ) {
    return undefined
  }

  return sample
}

function sanitizeGpsRawInt(input: GpsRawIntSample | undefined): GpsRawIntSample | undefined {
  if (!input) {
    return undefined
  }

  const sample: GpsRawIntSample = {
    cogCdeg: toFiniteNumber(input.cogCdeg),
    velCms: toFiniteNumber(input.velCms),
  }

  if (sample.cogCdeg === undefined && sample.velCms === undefined) {
    return undefined
  }

  return sample
}

export function sanitizeTelemetrySample(input: TelemetrySample): TelemetrySample {
  const sanitizedTimestamp = toFiniteNumber(input.timestampMs) ?? 0

  return {
    timestampMs: sanitizedTimestamp,
    attitude: sanitizeAttitude(input.attitude),
    vfrHud: sanitizeVfrHud(input.vfrHud),
    globalPositionInt: sanitizeGlobalPositionInt(input.globalPositionInt),
    gpsRawInt: sanitizeGpsRawInt(input.gpsRawInt),
  }
}
