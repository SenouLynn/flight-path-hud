/**
 * The synthetic node roster — data only, no behaviour.
 *
 * Each entry is one vehicle on the link: its MAVLink identity, where it launched
 * from, which flight profile it flies, and the mission it will hand back when
 * asked. `mockFleet.js` turns these into envelopes; nothing here knows about
 * sockets, timers or the wire.
 *
 * Adding a node is adding an entry. Distinct `sysId`s are what keep them from
 * merging into one contradictory aircraft downstream.
 */

import {
  DEFAULT_FIGURE_EIGHT_CONFIG,
  DEFAULT_SNAKE_CONFIG,
  figureEightWaypoints,
  toGeodetic,
} from './flightProfiles.js'

/** Arbitrary launch point (Zürich-ish) at 500 m MSL, unchanged from the original mock. */
export const ORIGIN = { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 }

const MAV_CMD_NAV_WAYPOINT = 16
/** MAV_FRAME_GLOBAL_RELATIVE_ALT — waypoint altitudes are relative to the launch point. */
const FRAME_GLOBAL_RELATIVE_ALT = 3

/** Places a second launch point a fixed ENU offset from the first. */
function offsetOrigin(origin, { northM, eastM, upM = 0 }) {
  return toGeodetic(origin, { northM, eastM, upM })
}

/**
 * Far enough from ORIGIN that the two nodes read as separate aircraft rather than
 * one glitching one, close enough that both fit in a single map view at ~zoom 16.
 */
export const FIGURE_EIGHT_ORIGIN = offsetOrigin(ORIGIN, { northM: 500, eastM: 600 })

/** A fixed 3-waypoint mission near ORIGIN, offset a few hundred metres each way. */
const SNAKE_MISSION = [
  { seq: 0, command: MAV_CMD_NAV_WAYPOINT, current: true, autocontinue: true, frameId: FRAME_GLOBAL_RELATIVE_ALT, latDegE7: ORIGIN.latDegE7 + 2000, lonDegE7: ORIGIN.lonDegE7 + 2000, altM: 80 },
  { seq: 1, command: MAV_CMD_NAV_WAYPOINT, current: false, autocontinue: true, frameId: FRAME_GLOBAL_RELATIVE_ALT, latDegE7: ORIGIN.latDegE7 + 4000, lonDegE7: ORIGIN.lonDegE7 - 1000, altM: 100 },
  { seq: 2, command: MAV_CMD_NAV_WAYPOINT, current: false, autocontinue: true, frameId: FRAME_GLOBAL_RELATIVE_ALT, latDegE7: ORIGIN.latDegE7 - 1000, lonDegE7: ORIGIN.lonDegE7 - 3000, altM: 60 },
]

/**
 * The figure-eight node's mission is *generated from the curve it actually flies*
 * (`figureEightWaypoints`), not placed by hand — so the planned route and the live
 * track genuinely coincide instead of merely looking similar. Four waypoints, one
 * per lobe extreme, in flight order.
 */
function figureEightMission(origin, config) {
  return figureEightWaypoints(config).map((waypoint) => ({
    seq: waypoint.seq,
    command: MAV_CMD_NAV_WAYPOINT,
    current: waypoint.seq === 0,
    autocontinue: true,
    frameId: FRAME_GLOBAL_RELATIVE_ALT,
    ...toGeodetic(origin, { northM: waypoint.northM, eastM: waypoint.eastM, upM: 0 }),
    // Relative to the launch point, which is what FRAME_GLOBAL_RELATIVE_ALT means.
    altM: Number(waypoint.upM.toFixed(1)),
  }))
}

export const MOCK_NODES = [
  {
    id: 'snake-01',
    sysId: 1,
    compId: 1,
    label: 'Snake 01',
    profile: 'snake',
    profileConfig: DEFAULT_SNAKE_CONFIG,
    origin: ORIGIN,
    mission: SNAKE_MISSION,
  },
  {
    id: 'figure8-01',
    sysId: 2,
    compId: 1,
    label: 'Figure-8 01',
    profile: 'figureEight',
    profileConfig: DEFAULT_FIGURE_EIGHT_CONFIG,
    origin: FIGURE_EIGHT_ORIGIN,
    mission: figureEightMission(FIGURE_EIGHT_ORIGIN, DEFAULT_FIGURE_EIGHT_CONFIG),
  },
]

/**
 * Pick a subset of the roster by id, so the same producer covers both the
 * single-stream and multi-stream test cases. An empty or absent selection means
 * the whole roster.
 *
 * Throws on an unknown id rather than silently flying fewer nodes than asked
 * for — a typo here would otherwise look like a node that failed to appear.
 */
export function selectNodes(selection, nodes = MOCK_NODES) {
  const ids = (selection ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '')

  if (ids.length === 0) {
    return nodes
  }

  return ids.map((id) => {
    const node = nodes.find((candidate) => candidate.id === id)
    if (node === undefined) {
      throw new Error(`unknown mock node "${id}"; available: ${nodes.map((n) => n.id).join(', ')}`)
    }
    return node
  })
}
