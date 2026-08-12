/**
 * Home position: the resting place for the vehicle.
 *
 * Plain lat/lon passthrough, no ENU projection or coordinate transformation.
 */

import type { LatLon } from './geodesy'
import type { HomeWireFrame } from './wire'

export interface HomePosition extends LatLon {
  altMslM: number
}

/** Plain lat/lon passthrough, no ENU projection — see Global Constraints. */
export function homeFromWireFrame(frame: HomeWireFrame): HomePosition {
  return { latDeg: frame.lat, lonDeg: frame.lon, altMslM: frame.altMslM }
}
