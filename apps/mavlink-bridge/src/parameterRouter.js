import { encodeParameterRequestRead } from './parameterProtocol.js'

const UINT8_MAX = 255
const DEFAULT_TIMEOUT_MS = 1500

function isTargetId(value) {
  return Number.isInteger(value) && value > 0 && value <= UINT8_MAX
}

function validRequest(message) {
  if (typeof message.requestId !== 'string' || message.requestId.trim() === '') return 'invalid requestId'
  if (!isTargetId(message.sysId) || !isTargetId(message.compId)) return 'invalid target: expected non-broadcast uint8 sysId/compId'
  const hasName = typeof message.name === 'string'
  const hasIndex = Number.isInteger(message.index)
  if (hasName === hasIndex) return 'specify exactly one of parameter name or index'
  if (hasName && (message.name.length === 0 || message.name.length > 16 || !/^[\x20-\x7E]+$/.test(message.name))) {
    return 'parameter name must be 1-16 printable ASCII bytes'
  }
  if (hasIndex && (message.index < 0 || message.index > 32767)) return 'parameter index must be in the range 0-32767'
  return null
}

function matches(pending, value) {
  return pending.name !== null ? value.paramId === pending.name : value.paramIndex === pending.index
}

function queryKey(sysId, compId, name, index) {
  return `${sysId}:${compId}:${name === null ? `#${index}` : `$${name}`}`
}

/** Portable read-only PARAM_REQUEST_READ/PARAM_VALUE state machine. */
export function createParameterRouter({
  send, canSend, isLive = () => true, recordEvent = () => undefined,
  now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = 2,
  gcsSysId = 255, gcsCompId = 190,
} = {}) {
  const pending = new Map()
  const pendingQueries = new Map()
  const cache = new Map()

  function emit(frame) {
    cache.set(frame.requestId, frame)
    recordEvent(frame)
    return frame
  }

  function fail(message, reason) {
    const frame = {
      type: 'parameterRead', requestId: typeof message?.requestId === 'string' ? message.requestId : null,
      sysId: isTargetId(message?.sysId) ? message.sysId : null,
      compId: isTargetId(message?.compId) ? message.compId : null,
      name: typeof message?.name === 'string' ? message.name : null,
      index: Number.isInteger(message?.index) ? message.index : null,
      status: 'failed', value: null, reason, updatedAtMs: now(),
    }
    if (frame.requestId !== null) recordEvent(frame)
    return frame
  }

  return {
    handleClientMessage(message) {
      if (message === null || typeof message !== 'object' || message.type !== 'requestParameter') return null
      const invalid = validRequest(message)
      if (invalid !== null) return fail(message, invalid)
      if (!isLive()) return fail(message, 'replay mode: no live vehicle to query')
      if (pending.has(message.requestId) || cache.has(message.requestId)) return fail(message, 'duplicate requestId')
      if (!canSend(message.sysId, message.compId)) return fail(message, 'no live UDP endpoint for requested system')

      const name = typeof message.name === 'string' ? message.name : null
      const index = Number.isInteger(message.index) ? message.index : null
      const key = queryKey(message.sysId, message.compId, name, index)
      if (pendingQueries.has(key)) return fail(message, 'same parameter read already pending for target')
      const buffer = encodeParameterRequestRead({
        sysId: gcsSysId, compId: gcsCompId,
        targetSystemId: message.sysId, targetComponentId: message.compId,
        name, index: index ?? -1,
      })
      const frame = {
        type: 'parameterRead', requestId: message.requestId, sysId: message.sysId, compId: message.compId,
        name, index, status: 'pending', value: null, reason: null, attempts: 1, updatedAtMs: now(),
      }
      if (send(message.sysId, message.compId, buffer) === false) return emit({ ...frame, status: 'failed', reason: 'target route disappeared before transmit' })
      pending.set(message.requestId, { frame, buffer, key })
      pendingQueries.set(key, message.requestId)
      return emit(frame)
    },

    ingestEnvelope(envelope) {
      if (envelope?.messageName !== 'PARAM_VALUE') return null
      const value = envelope.payload?.paramValue
      if (value === undefined) return null
      const match = [...pending.entries()].find(([, item]) => (
        item.frame.sysId === envelope.sysId && item.frame.compId === envelope.compId && matches(item.frame, value)
      ))
      if (match === undefined) return null
      const [requestId, item] = match
      pending.delete(requestId)
      pendingQueries.delete(item.key)
      return emit({ ...item.frame, status: 'complete', value, reason: null, updatedAtMs: now() })
    },

    tick(nowMs = now()) {
      const frames = []
      pending.forEach((item, requestId) => {
        if (nowMs - item.frame.updatedAtMs < timeoutMs) return
        if (item.frame.attempts <= maxRetries && canSend(item.frame.sysId, item.frame.compId)) {
          if (send(item.frame.sysId, item.frame.compId, item.buffer) !== false) {
            item.frame = emit({ ...item.frame, attempts: item.frame.attempts + 1, updatedAtMs: nowMs })
            frames.push(item.frame)
            return
          }
        }
        pending.delete(requestId)
        pendingQueries.delete(item.key)
        const reason = canSend(item.frame.sysId, item.frame.compId)
          ? 'PARAM_VALUE timeout' : 'target route became stale while awaiting PARAM_VALUE'
        frames.push(emit({ ...item.frame, status: 'failed', reason, updatedAtMs: nowMs }))
      })
      return frames
    },

    ingestRecordedEvent(frame) {
      if (frame?.type !== 'parameterRead' || typeof frame.requestId !== 'string') return null
      cache.set(frame.requestId, frame)
      return frame
    },

    snapshotForNewClient: () => [...cache.values()],
  }
}
