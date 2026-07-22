import { sanitizeTelemetrySample, type TelemetrySample } from './telemetry'

const RAD_TO_DEG = 180 / Math.PI

export interface Point2d {
  x: number
  y: number
}

export interface HorizonConfig {
  pixelsPerDegree: number
  lineHalfWidthPx: number
  maxPitchDegrees: number
  pitchPositiveMovesDown: boolean
}

export interface HorizonTransform {
  pitchDeg: number
  rollDeg: number
  pitchOffsetPx: number
  start: Point2d
  end: Point2d
}

export interface AttitudeResolution {
  pitchDeg: number | null
  rollDeg: number | null
  hasAttitude: boolean
}

export const DEFAULT_HORIZON_CONFIG: HorizonConfig = {
  pixelsPerDegree: 6,
  lineHalfWidthPx: 80,
  maxPitchDegrees: 30,
  pitchPositiveMovesDown: true,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function radiansToDegrees(valueRad: number): number {
  return valueRad * RAD_TO_DEG
}

export function normalizeRollDegrees(valueDeg: number): number {
  const normalized = valueDeg % 360
  const wrapped = normalized > 180 ? normalized - 360 : normalized
  return wrapped <= -180 ? wrapped + 360 : wrapped
}

export function resolveAttitude(sampleInput: TelemetrySample): AttitudeResolution {
  const sample = sanitizeTelemetrySample(sampleInput)
  const pitchRad = sample.attitude?.pitchRad
  const rollRad = sample.attitude?.rollRad

  if (pitchRad === undefined || rollRad === undefined) {
    return {
      pitchDeg: null,
      rollDeg: null,
      hasAttitude: false,
    }
  }

  return {
    pitchDeg: radiansToDegrees(pitchRad),
    rollDeg: normalizeRollDegrees(radiansToDegrees(rollRad)),
    hasAttitude: true,
  }
}

function rotatePoint(point: Point2d, angleRad: number): Point2d {
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)

  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  }
}

export function computeHorizonTransform(
  sampleInput: TelemetrySample,
  config: HorizonConfig = DEFAULT_HORIZON_CONFIG,
): HorizonTransform | null {
  const attitude = resolveAttitude(sampleInput)

  if (!attitude.hasAttitude || attitude.pitchDeg === null || attitude.rollDeg === null) {
    return null
  }

  const clampedPitchDeg = clamp(attitude.pitchDeg, -config.maxPitchDegrees, config.maxPitchDegrees)
  const pitchDirection = config.pitchPositiveMovesDown ? 1 : -1
  const pitchOffsetPx = clampedPitchDeg * config.pixelsPerDegree * pitchDirection
  const rollRad = (attitude.rollDeg * Math.PI) / 180

  const baseStart: Point2d = { x: -config.lineHalfWidthPx, y: pitchOffsetPx }
  const baseEnd: Point2d = { x: config.lineHalfWidthPx, y: pitchOffsetPx }

  return {
    pitchDeg: attitude.pitchDeg,
    rollDeg: attitude.rollDeg,
    pitchOffsetPx,
    start: rotatePoint(baseStart, rollRad),
    end: rotatePoint(baseEnd, rollRad),
  }
}
