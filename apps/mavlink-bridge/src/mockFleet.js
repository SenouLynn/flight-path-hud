/**
 * Transport-agnostic mock fleet: time in, wire-ready output out.
 *
 * Same split as bridgeCore.js/index.js — this file owns the per-node state and
 * the message shapes but knows nothing about UDP, so it can be driven from a test
 * with an injected clock. `mockFleetRunner.js` is the executable that binds a
 * socket to it.
 *
 * ## Why one process hosts every node
 *
 * The alternative — one process per vehicle — needs a lock port each and makes the
 * bridge's duplicate-transmitter detector ambiguous. That detector keys conflicts
 * by `system -> set of source endpoints`, so several *distinct* sysIds sharing one
 * endpoint is correctly not a conflict, while the thing it exists to catch (one
 * sysId arriving from two endpoints) still is. One socket keeps that signal clean.
 *
 * All per-node state lives in the `state` map below. The original single-node
 * sender kept its position and sequence counter at module scope, which is exactly
 * what made a second node impossible.
 */

import { decodeMissionRequest } from './encode.js'
import { encodeMissionCount, encodeMissionItemInt } from './normalize.js'
import { PROFILES, stepDeadReckoning, toGeodetic } from './flightProfiles.js'

/** MAVLink ATTITUDE.yaw is a signed radian angle from north, not 0..2pi. */
function wrapToPi(rad) {
  return Math.atan2(Math.sin(rad), Math.cos(rad))
}

/**
 * Target system/component 0 is MAVLink broadcast — "every system on the link" —
 * so a node matches when the request names it *or* names everyone. Real autopilots
 * answer a broadcast, and so do these.
 */
function addressesNode(request, node) {
  const systemMatches = request.targetSystem === 0 || request.targetSystem === node.sysId
  const componentMatches = request.targetComponent === 0 || request.targetComponent === node.compId
  return systemMatches && componentMatches
}

export function createMockFleet({ nodes, now = Date.now }) {
  if (nodes.length === 0) {
    throw new Error('createMockFleet needs at least one node')
  }

  const unknownProfiles = nodes.filter((node) => PROFILES[node.profile] === undefined)
  if (unknownProfiles.length > 0) {
    throw new Error(`unknown flight profile(s): ${unknownProfiles.map((n) => `${n.id}:${n.profile}`).join(', ')}`)
  }

  /*
   * Phase is measured from process start rather than from the wall clock. The
   * original mock used absolute epoch seconds, which meant every run began at an
   * arbitrary point in the cycle; starting from zero makes a run reproducible and
   * puts the figure eight at its crossing (wings level) on the first frame.
   */
  const startedAtMs = now()

  const state = new Map(nodes.map((node) => [node.id, {
    position: null,
    sequence: 0,
    lastTickMs: startedAtMs,
  }]))

  /** One JSON envelope, in the shape the bridge's UDP ingress expects. */
  function envelope(node, nodeState, nowMs, messageName, payload) {
    nodeState.sequence = (nodeState.sequence + 1) % 256

    return {
      recvTimestampMs: nowMs,
      sysId: node.sysId,
      compId: node.compId,
      messageName,
      sequence: nodeState.sequence,
      payload: { timestampMs: nowMs, ...payload },
    }
  }

  function frameNode(node, nowMs) {
    const nodeState = state.get(node.id)
    const kinematics = PROFILES[node.profile]((nowMs - startedAtMs) / 1000, node.profileConfig)

    const dtSec = (nowMs - nodeState.lastTickMs) / 1000
    nodeState.lastTickMs = nowMs
    // Analytic profiles ignore the previous position entirely; integrated ones
    // accumulate. stepDeadReckoning decides, based on the kinematics it is given.
    nodeState.position = stepDeadReckoning(nodeState.position, kinematics, dtSec)

    const fixed = toGeodetic(node.origin, nodeState.position)
    const { headingDeg, rollRad, pitchRad, groundSpeedMps, climbMps, vNorthMps, vEastMps } = kinematics
    const headingWireDeg = Math.round(headingDeg)

    return [
      envelope(node, nodeState, nowMs, 'HEARTBEAT', {
        heartbeat: {
          customMode: 0,
          vehicleType: 0,
          autopilotType: 0,
          baseMode: 0,
          armed: false,
          systemStatus: 0,
          mavlinkVersion: 3,
        },
      }),

      envelope(node, nodeState, nowMs, 'ATTITUDE', {
        attitude: {
          rollRad,
          pitchRad,
          // Yaw is the same physical direction as the reported heading. The
          // original mock offset this by 180 deg, which put the orientation
          // indicator's wireframe opposite the map track; harmless while one
          // node flew a narrow heading band, actively misleading next to a node
          // that sweeps the full circle.
          yawRad: wrapToPi((headingWireDeg * Math.PI) / 180),
          pitchSpeedRadPerSec: 0,
          yawSpeedRadPerSec: 0,
        },
      }),

      envelope(node, nodeState, nowMs, 'VFR_HUD', {
        vfrHud: {
          headingDeg: headingWireDeg,
          airSpeedMps: groundSpeedMps,
          groundSpeedMps,
          climbMps,
        },
      }),

      envelope(node, nodeState, nowMs, 'GLOBAL_POSITION_INT', {
        globalPositionInt: {
          latDegE7: fixed.latDegE7,
          lonDegE7: fixed.lonDegE7,
          altMm: fixed.altMm,
          relativeAltMm: Math.round(nodeState.position.upM * 1000),
          headingCdeg: headingWireDeg * 100,
          vxCms: Math.round(vNorthMps * 100),
          vyCms: Math.round(vEastMps * 100),
          // vz is positive-DOWN in MAVLink; climb is positive-up.
          vzCms: Math.round(-climbMps * 100),
        },
      }),

      envelope(node, nodeState, nowMs, 'GPS_RAW_INT', {
        gpsRawInt: {
          cogCdeg: headingWireDeg * 100,
          velCms: Math.round(groundSpeedMps * 100),
        },
      }),
    ]
  }

  return {
    /** Advance every node one tick; returns the envelopes to send. */
    tick(nowMs = now()) {
      return nodes.flatMap((node) => frameNode(node, nowMs))
    },

    /**
     * Play the vehicle side of the mission handshake: decode what the bridge just
     * sent and reply with real, CRC'd frames from whichever node was addressed.
     *
     * No state is kept across calls — every request is answered from the roster
     * fresh, matching how a real autopilot answers the same request twice
     * identically.
     */
    handleMissionRequest(datagram) {
      const request = decodeMissionRequest(datagram)
      if (request === null) {
        return []
      }

      const targets = nodes.filter((node) => addressesNode(request, node))

      if (request.messageName === 'MISSION_REQUEST_LIST') {
        return targets.map((node) => encodeMissionCount({
          sysId: node.sysId,
          compId: node.compId,
          count: node.mission.length,
        }))
      }

      return targets.flatMap((node) => {
        // By seq, not array index: the roster is not required to be dense or sorted.
        const item = node.mission.find((candidate) => candidate.seq === request.seq)
        return item === undefined
          ? []
          : [encodeMissionItemInt({ sysId: node.sysId, compId: node.compId, item })]
      })
    },

    describe: () => nodes.map((node) => `${node.id} (sys ${node.sysId}:${node.compId}, ${node.profile})`),
  }
}
