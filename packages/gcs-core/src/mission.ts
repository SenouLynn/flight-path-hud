/**
 * Mission plan state: the abstraction between the wire frame and the UI.
 *
 * Pure fold in the shape of the bridge contract: the bridge always sends a
 * complete snapshot (every `mission` frame is the full current plan), so there
 * is nothing to carry forward from a previous frame. Pure mapping, named to make
 * that explicit rather than implying an accumulation that doesn't happen.
 */

import type { MissionWireFrame, MissionItemWire } from './wire'

export interface MissionItem {
  seq: number
  command: number
  current: boolean
  autocontinue: boolean
  latDeg: number
  lonDeg: number
  altM: number
}

export type MissionStatus = 'idle' | 'pending' | 'complete' | 'failed'

export interface MissionPlan {
  status: MissionStatus
  items: MissionItem[]
  /** A `seq` value, NOT an array index. Compare with `item.seq === activeIndex`, never `items[activeIndex]`. */
  activeIndex: number | null
  reason: string | null
}

/** "Not requested yet" — a purely client-side default. The wire never sends
 * status:'idle'; the bridge only ever speaks once a mission has been requested (or
 * replays its cache on connect). */
export const EMPTY_MISSION: MissionPlan = { status: 'idle', items: [], activeIndex: null, reason: null }

/**
 * NOT a stateful merge like mergeVehicleState in vehicle.ts — the bridge always sends
 * a complete snapshot (every `mission` frame is the full current plan, per
 * missionRouter.js), so there is nothing to carry forward from a previous frame. Pure
 * mapping, named to make that explicit rather than implying an accumulation that
 * doesn't happen.
 */
export function missionPlanFromFrame(frame: MissionWireFrame): MissionPlan {
  const items: MissionItem[] = frame.items.map((item: MissionItemWire) => ({
    seq: item.seq,
    command: item.command,
    current: item.current,
    autocontinue: item.autocontinue,
    latDeg: item.latDeg,
    lonDeg: item.lonDeg,
    altM: item.altM,
  }))

  return {
    status: frame.status,
    items,
    activeIndex: frame.activeIndex,
    reason: frame.reason,
  }
}
