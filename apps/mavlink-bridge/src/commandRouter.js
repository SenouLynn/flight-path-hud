const UINT8_MAX = 255
const DEFAULT_TIMEOUT_MS = 3000

function isUint8(value) {
  return Number.isInteger(value) && value >= 0 && value <= UINT8_MAX
}

function commandKey(sysId, compId, command) {
  return `${sysId}:${compId}:${command}`
}

function failure(message, reason, nowMs) {
  return {
    type: 'commandStatus',
    requestId: typeof message?.requestId === 'string' ? message.requestId : null,
    sysId: isUint8(message?.sysId) ? message.sysId : null,
    compId: isUint8(message?.compId) ? message.compId : null,
    family: typeof message?.family === 'string' ? message.family : null,
    actor: typeof message?.actor === 'string' ? message.actor : null,
    requestedAtMs: Number.isFinite(message?.timestampMs) ? message.timestampMs : null,
    confirmation: message?.confirmation === true,
    status: 'rejected', reason, updatedAtMs: nowMs,
  }
}

/**
 * Policy and lifecycle boundary for future state-changing MAVLink commands.
 * Production starts with an empty allowlist: registering a family is an explicit
 * code change, not something an unauthenticated WebSocket client can request.
 */
export function createCommandRouter({
  definitions = new Map(), send, canSend, isLive = () => true,
  recordEvent = () => undefined, now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 2,
} = {}) {
  const pendingByRequest = new Map()
  const pendingByCommand = new Map()
  const cache = new Map()

  function emit(frame) {
    cache.set(frame.requestId, frame)
    recordEvent(frame)
    return frame
  }

  function reject(message, reason) {
    const frame = failure(message, reason, now())
    if (frame.requestId !== null) recordEvent(frame)
    return frame
  }

  return {
    handleClientMessage(message) {
      if (message === null || typeof message !== 'object' || message.type !== 'commandRequest') return null
      if (typeof message.requestId !== 'string' || message.requestId.trim() === '') return reject(message, 'invalid requestId')
      if (!isUint8(message.sysId) || !isUint8(message.compId) || message.sysId === 0 || message.compId === 0) {
        return reject(message, 'invalid target: expected non-broadcast uint8 sysId/compId')
      }
      if (typeof message.actor !== 'string' || message.actor.trim() === '') return reject(message, 'invalid actor')
      if (!Number.isFinite(message.timestampMs)) return reject(message, 'invalid timestampMs')
      if (message.confirmation !== true) return reject(message, 'explicit confirmation required')
      if (!isLive()) return reject(message, 'replay mode: commands are disabled')
      if (pendingByRequest.has(message.requestId) || cache.has(message.requestId)) return reject(message, 'duplicate requestId')

      const definition = definitions.get(message.family)
      if (definition === undefined) return reject(message, 'command family is not allowlisted')
      if (!canSend(message.sysId, message.compId)) return reject(message, 'no live UDP endpoint for requested system')

      const command = definition.command
      const key = commandKey(message.sysId, message.compId, command)
      if (pendingByCommand.has(key)) return reject(message, 'same command already pending for target')

      let buffer
      try {
        buffer = definition.encode({
          sysId: message.sysId, compId: message.compId,
          params: message.params ?? {},
        })
      } catch (error) {
        return reject(message, `invalid command parameters: ${error?.message ?? error}`)
      }

      const requested = emit({
        type: 'commandStatus', requestId: message.requestId,
        sysId: message.sysId, compId: message.compId, family: message.family,
        actor: message.actor, requestedAtMs: message.timestampMs, confirmation: true,
        command, status: 'requested', result: null, reason: null, updatedAtMs: now(),
      })
      if (send(message.sysId, message.compId, buffer) === false) {
        return emit({ ...requested, status: 'failed', reason: 'target route disappeared before transmit', updatedAtMs: now() })
      }
      const transmitted = emit({ ...requested, status: 'transmitted', updatedAtMs: now() })
      pendingByRequest.set(message.requestId, { frame: transmitted, buffer, attempts: 1 })
      pendingByCommand.set(key, message.requestId)
      return transmitted
    },

    ingestEnvelope(envelope) {
      if (envelope?.messageName !== 'COMMAND_ACK') return null
      const command = envelope.payload?.commandAck?.command
      const requestId = pendingByCommand.get(commandKey(envelope.sysId, envelope.compId, command))
      if (requestId === undefined) return null
      const pending = pendingByRequest.get(requestId)
      pendingByRequest.delete(requestId)
      pendingByCommand.delete(commandKey(envelope.sysId, envelope.compId, command))
      const result = envelope.payload.commandAck.result
      return emit({ ...pending.frame, status: result === 0 ? 'acknowledged' : 'failed', result,
        reason: result === 0 ? null : `COMMAND_ACK result ${result}`, updatedAtMs: now() })
    },

    tick(nowMs = now()) {
      const frames = []
      pendingByRequest.forEach((pending, requestId) => {
        if (nowMs - pending.frame.updatedAtMs < timeoutMs) return
        if (pending.attempts <= maxRetries && canSend(pending.frame.sysId, pending.frame.compId)) {
          if (send(pending.frame.sysId, pending.frame.compId, pending.buffer) === false) {
            pendingByRequest.delete(requestId)
            pendingByCommand.delete(commandKey(pending.frame.sysId, pending.frame.compId, pending.frame.command))
            frames.push(emit({ ...pending.frame, status: 'timedOut',
              reason: 'target route disappeared before retry', updatedAtMs: nowMs }))
            return
          }
          pending.attempts += 1
          pending.frame = emit({ ...pending.frame, status: 'retrying', attempts: pending.attempts,
            reason: null, updatedAtMs: nowMs })
          frames.push(pending.frame)
          return
        }
        pendingByRequest.delete(requestId)
        pendingByCommand.delete(commandKey(pending.frame.sysId, pending.frame.compId, pending.frame.command))
        const reason = canSend(pending.frame.sysId, pending.frame.compId)
          ? 'COMMAND_ACK timeout'
          : 'target route became stale while awaiting COMMAND_ACK'
        frames.push(emit({ ...pending.frame, status: 'timedOut', reason, updatedAtMs: nowMs }))
      })
      return frames
    },

    ingestRecordedEvent(frame) {
      if (frame?.type !== 'commandStatus' || typeof frame.requestId !== 'string') return null
      cache.set(frame.requestId, frame)
      return frame
    },

    snapshotForNewClient: () => [...cache.values()],
  }
}
