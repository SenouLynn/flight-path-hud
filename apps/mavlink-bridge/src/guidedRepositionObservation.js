const EARTH_RADIUS_M = 6_371_000
const radians = (degrees) => degrees * Math.PI / 180

/** Pure post-condition math using only normalized numeric telemetry. */
export function guidedPositionError(position, target) {
  if (position === null || typeof position !== 'object') return null
  const values = [position.latDegE7, position.lonDegE7, position.relativeAltMm,
    target.latitudeDeg, target.longitudeDeg, target.relativeAltitudeM]
  if (!values.every(Number.isFinite)) return null
  const lat1 = radians(position.latDegE7 / 1e7), lat2 = radians(target.latitudeDeg)
  const deltaLat = lat2 - lat1
  const deltaLon = radians(target.longitudeDeg - position.lonDegE7 / 1e7)
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return { horizontalDistanceM: 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a))),
    altitudeErrorM: Math.abs(position.relativeAltMm / 1000 - target.relativeAltitudeM) }
}

export function observesGuidedTarget(position, target) {
  const error = guidedPositionError(position, target)
  return error === null ? null : { ...error, arrived: error.horizontalDistanceM <= target.arrivalRadiusM
    && error.altitudeErrorM <= target.altitudeToleranceM }
}
