import { isDeepStrictEqual } from 'node:util'
import { createMissionSync } from './missionSync.js'

const MISSION_MESSAGE_NAMES = new Set(['MISSION_COUNT', 'MISSION_ITEM_INT', 'MISSION_CURRENT', 'MISSION_ACK'])

const UINT8_MAX = 255

// QGroundControl-style GCS identity, used as this bridge's own sysId/compId in
// every outbound frame header. Overridable in case a deployment needs a specific
// identity to avoid colliding with another GCS on the same link.
const GCS_SYSTEM_ID = Number.parseInt(process.env.MAVLINK_BRIDGE_GCS_SYSTEM_ID ?? '255', 10)
const GCS_COMPONENT_ID = Number.parseInt(process.env.MAVLINK_BRIDGE_GCS_COMPONENT_ID ?? '190', 10)

function systemKey(sysId, compId) {
  return `${sysId}:${compId}`
}

/**
 * A client's sysId/compId comes from an unauthenticated browser WebSocket and
 * ends up in encode.js's Buffer.writeUInt8, which has two unacceptable failure
 * modes for untrusted input: anything outside 0-255 throws ERR_OUT_OF_RANGE
 * (which propagated out of the ws message handler and killed the process), and
 * `undefined` coerces silently to 0 — MAVLink's "broadcast to every vehicle on
 * the link". So nothing that isn't a real uint8 reaches missionSync/encode.js.
 */
function isUint8(value) {
  return Number.isInteger(value) && value >= 0 && value <= UINT8_MAX
}

function toWireStatus(internalStatus) {
  if (internalStatus === 'requested' || internalStatus === 'collecting') {
    return 'pending'
  }
  if (internalStatus === 'complete' || internalStatus === 'published') {
    return 'complete'
  }
  return 'failed'
}

function toWireItem(item) {
  return {
    seq: item.seq,
    command: item.command,
    current: item.current,
    autocontinue: item.autocontinue,
    latDeg: item.latDegE7 / 1e7,
    lonDeg: item.lonDegE7 / 1e7,
    altM: item.altM,
  }
}

/**
 * Transport-agnostic multi-vehicle router, like bridgeCore.js: fed decoded
 * envelopes and parsed client messages, emits the frames index.js should
 * broadcast. Owns the per-system missionSync instances and the last-known
 * mission/home cache that lets a late-connecting client see state immediately
 * (design doc §4) instead of waiting for the next natural event.
 */
export function createMissionRouter({ send, canSend, now = Date.now }) {
  const syncs = new Map()
  const missionCache = new Map()
  const homeCache = new Map()

  function syncFor(sysId, compId) {
    const key = systemKey(sysId, compId)
    let sync = syncs.get(key)

    if (sync === undefined) {
      sync = createMissionSync({
        send, now,
        sysId: GCS_SYSTEM_ID, compId: GCS_COMPONENT_ID,
        targetSystemId: sysId, targetComponentId: compId,
      })
      syncs.set(key, sync)
    }

    return sync
  }

  function missionFrameFor(sysId, compId, sync) {
    const state = sync.getState()
    const frame = {
      type: 'mission',
      sysId,
      compId,
      status: toWireStatus(state.status),
      items: state.items.map(toWireItem),
      activeIndex: state.activeIndex,
      reason: state.reason,
    }
    missionCache.set(systemKey(sysId, compId), frame)

    if (state.status === 'complete') {
      sync.acknowledgePublished()
    }

    return frame
  }

  return {
    ingestEnvelope(envelope) {
      const { sysId, compId, messageName, payload } = envelope

      if (messageName === 'HOME_POSITION') {
        const frame = {
          type: 'home',
          sysId,
          compId,
          lat: payload.homePosition.latDegE7 / 1e7,
          lon: payload.homePosition.lonDegE7 / 1e7,
          altMslM: payload.homePosition.altMm / 1000,
        }
        homeCache.set(systemKey(sysId, compId), frame)
        return frame
      }

      if (!MISSION_MESSAGE_NAMES.has(messageName)) {
        return null
      }

      const sync = syncFor(sysId, compId)
      const changed = sync.ingestEnvelope(envelope)

      if (!changed) {
        return null
      }

      const cachedBefore = missionCache.get(systemKey(sysId, compId))

      // MISSION_CURRENT is routine, unprompted vehicle telemetry — missionSync
      // reports it as "changed" (it captures activeIndex) even when no
      // requestMission() has ever happened, i.e. status is still 'idle'. Don't
      // publish or cache a frame for that: there's nothing pending or failed,
      // just nothing to report yet.
      if (sync.getState().status === 'idle') {
        return null
      }

      const frame = missionFrameFor(sysId, compId, sync)

      // Same shape of problem as the 'idle' guard above, one state further on:
      // MISSION_CURRENT keeps arriving from the vehicle forever regardless of
      // mission-pull state, and missionSync reports every one as "changed". Once
      // a pull has settled (notably into 'failed'), that rebuilds a frame
      // byte-identical to the one already broadcast and re-sends it to every
      // client at the vehicle's telemetry rate. Nothing new to report, so report
      // nothing. Only this passive, envelope-driven path is deduped —
      // handleClientMessage() and tick() always publish, because a fresh client
      // request or a real state change is news even if a stale cache entry
      // happens to match.
      if (cachedBefore !== undefined && isDeepStrictEqual(cachedBefore, frame)) {
        return null
      }

      return frame
    },

    handleClientMessage(message) {
      if (message === null || typeof message !== 'object' || message.type !== 'requestMission') {
        return null
      }

      const { sysId, compId } = message

      if (!isUint8(sysId) || !isUint8(compId)) {
        // Deliberately not cached, unlike a genuine failed pull: an invalid
        // request names a system that may not exist at all, and caching it would
        // hand junk to every future client via snapshotForNewClient(). Ids are
        // still emitted as explicit nulls rather than dropped — wire shapes are
        // always fully populated.
        return {
          type: 'mission',
          sysId: isUint8(sysId) ? sysId : null,
          compId: isUint8(compId) ? compId : null,
          status: 'failed',
          items: [],
          activeIndex: null,
          reason: 'invalid sysId/compId: expected integers in the range 0-255',
        }
      }

      if (!canSend()) {
        const frame = { type: 'mission', sysId, compId, status: 'failed', items: [], activeIndex: null, reason: 'replay mode: no live vehicle to query' }
        missionCache.set(systemKey(sysId, compId), frame)
        return frame
      }

      const sync = syncFor(sysId, compId)
      sync.requestMission()
      return missionFrameFor(sysId, compId, sync)
    },

    tick(nowMs = now()) {
      const frames = []

      syncs.forEach((sync, key) => {
        if (sync.tick(nowMs)) {
          const [sysId, compId] = key.split(':').map(Number)
          frames.push(missionFrameFor(sysId, compId, sync))
        }
      })

      return frames
    },

    snapshotForNewClient() {
      return [...missionCache.values(), ...homeCache.values()]
    },
  }
}
