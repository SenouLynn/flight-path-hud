/**
 * Geodesy for the map view. Unlike the HUD's local ENU frame, a map works in
 * geographic coordinates, so these operate directly on lat/lon degrees.
 *
 * Framework-agnostic and dependency-free: usable from a browser, from Node for
 * log consumption, and from whatever renderer replaces the current one.
 */

/** Mean Earth radius (IUGG), the standard choice for haversine. */
const EARTH_RADIUS_M = 6371008.8
const DEG_E7 = 1e7
const CDEG_PER_DEG = 100
/** MAVLink GLOBAL_POSITION_INT.hdg sentinel for "heading unknown". */
export const UNKNOWN_HEADING_CDEG = 65535

export interface LatLon {
  latDeg: number
  lonDeg: number
}

function toRadians(valueDeg: number): number {
  return (valueDeg * Math.PI) / 180
}

function toDegrees(valueRad: number): number {
  return (valueRad * 180) / Math.PI
}

/** Wrap a compass bearing into [0, 360). */
export function normalizeBearingDeg(valueDeg: number): number {
  const wrapped = valueDeg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/** MAVLink lat/lon are int32 degrees scaled by 1e7. */
export function degE7ToDeg(valueDegE7: number): number {
  return valueDegE7 / DEG_E7
}

/** Centidegrees to degrees; `null` for the 65535 unknown sentinel. */
export function cdegToDeg(valueCdeg: number): number | null {
  if (valueCdeg === UNKNOWN_HEADING_CDEG) {
    return null
  }

  return valueCdeg / CDEG_PER_DEG
}

/** Great-circle distance in metres. */
export function distanceM(from: LatLon, to: LatLon): number {
  const lat1Rad = toRadians(from.latDeg)
  const lat2Rad = toRadians(to.latDeg)
  const deltaLatRad = toRadians(to.latDeg - from.latDeg)
  const deltaLonRad = toRadians(to.lonDeg - from.lonDeg)

  const a = Math.sin(deltaLatRad / 2) ** 2
    + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLonRad / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Initial great-circle bearing in [0, 360). Compass convention — atan2(east, north)
 * — matching `trackFromVxVy` in the HUD's flightPath resolver.
 */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const lat1Rad = toRadians(from.latDeg)
  const lat2Rad = toRadians(to.latDeg)
  const deltaLonRad = toRadians(to.lonDeg - from.lonDeg)

  const east = Math.sin(deltaLonRad) * Math.cos(lat2Rad)
  const north = Math.cos(lat1Rad) * Math.sin(lat2Rad)
    - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad)

  return normalizeBearingDeg(toDegrees(Math.atan2(east, north)))
}
