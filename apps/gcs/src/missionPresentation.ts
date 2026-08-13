/**
 * ArduPilot mission downloads expose item zero as the mission-home record and
 * report MISSION_CURRENT=0 while the vehicle is idle. That is useful protocol
 * state, but it is not a waypoint the aircraft is actively navigating toward.
 * Reserve the active presentation for actual mission items after home.
 */
export function isActiveMissionWaypoint(seq: number, activeIndex: number | null): boolean {
  return activeIndex !== null && activeIndex > 0 && seq === activeIndex
}

export function displayedActiveMissionIndex(activeIndex: number | null): number | null {
  return activeIndex !== null && activeIndex > 0 ? activeIndex : null
}

/**
 * Some mission commands describe an action at the vehicle's current position.
 * ArduPilot encodes those items with latitude/longitude 0,0; drawing that
 * protocol sentinel as geography creates a false route to the Gulf of Guinea.
 * Keep the item in mission state/progress, but omit it from spatial UI.
 */
export function hasDrawableMissionPosition(item: MissionItem): boolean {
  return item.latDeg !== 0 || item.lonDeg !== 0
}
import type { MissionItem } from '@flight-path-hud/gcs-core'
