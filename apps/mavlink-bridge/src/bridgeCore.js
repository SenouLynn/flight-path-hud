import { parseIncomingDatagram } from './normalize.js'

const DEFAULT_SYSTEM_TTL_MS = 10000

function systemKey(sysId, compId) {
  return `${sysId}:${compId}`
}

/**
 * Transport-agnostic bridge core: raw datagrams in, broadcast-ready frames out.
 * It owns the counters, the message-rate window and the system roster, but knows
 * nothing about UDP, WebSocket or files — so the UDP, replay and future serial
 * ingress adapters all drive the same normalization and health semantics.
 *
 * `now` is injected so replay can reproduce a session deterministically.
 */
export function createBridgeCore({ systemTtlMs = DEFAULT_SYSTEM_TTL_MS, now = Date.now } = {}) {
  let packetCount = 0
  let decodeErrorCount = 0
  let droppedPacketCount = 0
  let packetsSinceTick = 0
  let packetRateHz = 0
  let messageRates = []

  const messageCounts = new Map()
  const systems = new Map()
  // One sysId arriving from two endpoints means two transmitters claiming the same
  // vehicle. That is indistinguishable downstream — it merges into a single aircraft
  // with contradictory telemetry — so surface it here rather than let it look like a
  // rendering fault.
  const sourcesBySystem = new Map()
  const pendingConflicts = []

  const buildSystemsSnapshot = () => [...systems.values()].sort((left, right) => (
    left.sysId !== right.sysId ? left.sysId - right.sysId : left.compId - right.compId
  ))

  const buildHealth = () => ({
    packetRateHz,
    decodeErrorCount,
    droppedPacketCount,
    messageRates,
    systems: buildSystemsSnapshot(),
  })

  return {
    /** Decode one datagram; returns the frames to publish (possibly none). */
    ingestDatagram(rawBuffer, nowMs = now(), source = undefined) {
      const result = parseIncomingDatagram(rawBuffer, nowMs)

      if (result.decodeErrors > 0) {
        decodeErrorCount += result.decodeErrors
        droppedPacketCount += result.decodeErrors
      }

      return result.envelopes.map((envelope) => {
        packetCount += 1
        packetsSinceTick += 1
        messageCounts.set(envelope.messageName, (messageCounts.get(envelope.messageName) ?? 0) + 1)

        if (source !== undefined) {
          const key = systemKey(envelope.sysId, envelope.compId)
          let seenSources = sourcesBySystem.get(key)

          if (seenSources === undefined) {
            seenSources = new Set()
            sourcesBySystem.set(key, seenSources)
          }

          if (!seenSources.has(source)) {
            seenSources.add(source)
            if (seenSources.size > 1) {
              pendingConflicts.push({ system: key, sources: [...seenSources] })
            }
          }
        }

        systems.set(systemKey(envelope.sysId, envelope.compId), {
          sysId: envelope.sysId,
          compId: envelope.compId,
          // Bridge-local clock: a JSON sender's recvTimestampMs is self-reported and
          // would make TTL eviction hostage to its clock skew.
          lastSeenTimestampMs: nowMs,
        })

        // Consumers validate sequence as a uint8, so the synthesised fallback has to wrap like the wire field.
        const sequence = envelope.sequence > 0 ? envelope.sequence : packetCount % 256

        return { ...envelope, sequence, health: buildHealth() }
      })
    },

    /** Roll the 1Hz window: publish rates and evict systems that went quiet. */
    tick(nowMs = now()) {
      packetRateHz = packetsSinceTick
      packetsSinceTick = 0

      messageRates = [...messageCounts.entries()]
        .map(([messageName, rateHz]) => ({ messageName, rateHz }))
        .sort((left, right) => right.rateHz - left.rateHz || left.messageName.localeCompare(right.messageName))

      messageCounts.clear()

      const staleBeforeMs = nowMs - systemTtlMs
      systems.forEach((system, key) => {
        if (system.lastSeenTimestampMs < staleBeforeMs) {
          systems.delete(key)
          // Drop the source set too, or it accumulates an entry per system the
          // bridge has ever heard from for the life of the process.
          sourcesBySystem.delete(key)
        }
      })
    },

    /** Newly-detected duplicate transmitters, drained so each is reported once. */
    takeSourceConflicts: () => pendingConflicts.splice(0),

    systemCount: () => systems.size,
  }
}
