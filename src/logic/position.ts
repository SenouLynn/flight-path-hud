import { sanitizeTelemetrySample, type TelemetrySample } from './telemetry'

/**
 * Position resolver: turns a stream of samples into a cartesian track of where
 * the aircraft HAS BEEN, in a fixed local ENU frame anchored at the first fix.
 *
 * Frame: ENU (right-handed) — x = East, y = North, z = Up.
 *   • Absolute path : GLOBAL_POSITION_INT lat/lon/alt projected to ENU meters.
 *   • Fallback path : integrate NED velocity (vx = North, vy = East, vz = Down).
 *     NED sign flip — vz is positive-DOWN, so up integrates as (-vz).
 *
 * The math is pure and framework-free so it ports to C++/ESP32. State (the
 * previous point + timestamp, and the captured origin) is passed in as
 * arguments; the mutable accumulation lives in the React hook, not here.
 */

// Equatorial meters per degree of latitude (2π·R / 360, R = 6_378_137 m).
// Duplicated rather than imported so logic/ has no dependency on stream/.
const METERS_PER_DEG_LAT = 111319.49
const DEG_E7 = 1e7
const CM_PER_M = 100
const MM_PER_M = 1000
const MS_PER_SEC = 1000
// Clamp integration step so a timestamp gap can't fling a point across the map.
const MAX_INTEGRATION_DT_SEC = 5

export interface EnuPoint {
  eastM: number
  northM: number
  upM: number
}

export interface GeoOrigin {
  latDegE7: number
  lonDegE7: number
  altMm: number
}

export type PositionSource =
  | 'GLOBAL_POSITION_INT.lla_enu' // absolute GPS lat/lon/alt → ENU
  | 'GLOBAL_POSITION_INT.vxvy_vz_integrated' // dead-reckoned from NED velocity
  | 'none'

export interface TrackPoint extends EnuPoint {
  tSec: number // elapsed seconds since the first point of the track
  source: PositionSource
}

export interface PositionState {
  point: EnuPoint
  tSec: number
  lastTimestampMs: number
}

export interface PositionStepResult {
  state: PositionState
  point: TrackPoint
}

const ORIGIN_POINT: EnuPoint = { eastM: 0, northM: 0, upM: 0 }

function degrees(valueDegE7: number): number {
  return valueDegE7 / DEG_E7
}

/**
 * Equirectangular projection of an absolute LLA fix into local ENU meters,
 * relative to `origin`. Accurate to well under a meter at HUD-scale distances.
 */
export function projectLlaToEnu(
  latDegE7: number,
  lonDegE7: number,
  altMm: number,
  origin: GeoOrigin,
): EnuPoint {
  const lat0Rad = (degrees(origin.latDegE7) * Math.PI) / 180
  const eastM = degrees(lonDegE7 - origin.lonDegE7) * METERS_PER_DEG_LAT * Math.cos(lat0Rad)
  const northM = degrees(latDegE7 - origin.latDegE7) * METERS_PER_DEG_LAT
  const upM = (altMm - origin.altMm) / MM_PER_M
  return { eastM, northM, upM }
}

function hasAbsolutePosition(sample: TelemetrySample): boolean {
  const gp = sample.globalPositionInt
  return gp?.latDegE7 !== undefined && gp?.lonDegE7 !== undefined
}

/** Capture the ENU origin from the first sample carrying an absolute fix. */
export function originFromSample(sample: TelemetrySample): GeoOrigin | null {
  const gp = sanitizeTelemetrySample(sample).globalPositionInt
  if (gp?.latDegE7 === undefined || gp?.lonDegE7 === undefined) {
    return null
  }
  return {
    latDegE7: gp.latDegE7,
    lonDegE7: gp.lonDegE7,
    altMm: gp.altMm ?? gp.relativeAltMm ?? 0,
  }
}

function stepInternal(
  prev: PositionState | null,
  sample: TelemetrySample,
  origin: GeoOrigin | null,
): PositionStepResult {
  const rawDtSec = prev === null ? 0 : (sample.timestampMs - prev.lastTimestampMs) / MS_PER_SEC
  const dtSec = Number.isFinite(rawDtSec) && rawDtSec > 0 ? rawDtSec : 0
  const tSec = prev === null ? 0 : prev.tSec + dtSec
  const integrationDt = Math.min(dtSec, MAX_INTEGRATION_DT_SEC)

  const gp = sample.globalPositionInt
  let point: EnuPoint
  let source: PositionSource

  if (origin !== null && hasAbsolutePosition(sample) && gp !== undefined) {
    const altMm = gp.altMm ?? gp.relativeAltMm ?? origin.altMm
    point = projectLlaToEnu(gp.latDegE7!, gp.lonDegE7!, altMm, origin)
    source = 'GLOBAL_POSITION_INT.lla_enu'
  } else if (gp?.vxCms !== undefined && gp?.vyCms !== undefined) {
    const base = prev?.point ?? ORIGIN_POINT
    const vzCms = gp.vzCms ?? 0
    point = {
      eastM: base.eastM + (gp.vyCms / CM_PER_M) * integrationDt,
      northM: base.northM + (gp.vxCms / CM_PER_M) * integrationDt,
      upM: base.upM + (-vzCms / CM_PER_M) * integrationDt,
    }
    source = 'GLOBAL_POSITION_INT.vxvy_vz_integrated'
  } else {
    point = prev?.point ?? ORIGIN_POINT
    source = 'none'
  }

  return {
    state: { point, tSec, lastTimestampMs: sample.timestampMs },
    point: { ...point, tSec, source },
  }
}

/**
 * Advance the track by one sample. Prefers an absolute GPS fix (when an origin
 * is locked and lat/lon are present) and otherwise dead-reckons NED velocity
 * over the elapsed dt. `prev` and `origin` are supplied by the caller so this
 * stays a pure function.
 */
export function resolvePositionStep(
  prev: PositionState | null,
  sample: TelemetrySample,
  origin: GeoOrigin | null,
): PositionStepResult {
  return stepInternal(prev, sanitizeTelemetrySample(sample), origin)
}

/**
 * Fold an entire sample array into a track — the batch entry point for tests,
 * replay validation, and offline log analysis. Captures the ENU origin at the
 * first absolute fix; a pure-velocity stream integrates from (0,0,0).
 */
export function resolveTrack(samples: TelemetrySample[]): TrackPoint[] {
  const points: TrackPoint[] = []
  let origin: GeoOrigin | null = null
  let state: PositionState | null = null

  for (const raw of samples) {
    const sample = sanitizeTelemetrySample(raw)
    if (origin === null && hasAbsolutePosition(sample)) {
      origin = originFromSample(sample)
    }
    const result = stepInternal(state, sample, origin)
    state = result.state
    points.push(result.point)
  }

  return points
}
