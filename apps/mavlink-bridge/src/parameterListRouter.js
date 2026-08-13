import { encodeParameterRequestList } from './parameterProtocol.js'

const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
const targetKey = (sysId, compId) => `${sysId}:${compId}`

/** Portable fold for the PARAM_REQUEST_LIST/PARAM_VALUE streaming transaction. */
export function createParameterListRouter({
  send, canSend, isLive = () => true, recordEvent = () => undefined, now = Date.now,
  idleTimeoutMs = 3000, maxRetries = 2, gcsSysId = 255, gcsCompId = 190,
} = {}) {
  const pending = new Map()
  const targets = new Map()
  const cache = new Map()
  const emit = (frame, record = true) => {
    cache.set(frame.requestId, frame)
    if (record) recordEvent(frame)
    return frame
  }
  const fail = (message, reason) => ({
    type: 'parameterList', requestId: typeof message?.requestId === 'string' ? message.requestId : null,
    sysId: validId(message?.sysId) ? message.sysId : null, compId: validId(message?.compId) ? message.compId : null,
    status: 'failed', receivedCount: 0, expectedCount: null, parameters: [], reason, updatedAtMs: now(),
  })

  return {
    handleClientMessage(message) {
      if (message?.type !== 'requestParameterList') return null
      if (typeof message.requestId !== 'string' || message.requestId.trim() === '') return fail(message, 'invalid requestId')
      if (!validId(message.sysId) || !validId(message.compId)) return fail(message, 'invalid non-broadcast target')
      if (!isLive()) return fail(message, 'replay mode: no live vehicle to query')
      if (pending.has(message.requestId) || cache.has(message.requestId)) return fail(message, 'duplicate requestId')
      const key = targetKey(message.sysId, message.compId)
      if (targets.has(key)) return fail(message, 'parameter list already pending for target')
      if (!canSend(message.sysId, message.compId)) return fail(message, 'no live UDP endpoint for requested system')
      const buffer = encodeParameterRequestList({ sysId: gcsSysId, compId: gcsCompId,
        targetSystemId: message.sysId, targetComponentId: message.compId })
      const frame = { ...fail(message, null), status: 'pending', reason: null, attempts: 1 }
      if (send(message.sysId, message.compId, buffer) === false) return emit({ ...frame, status: 'failed', reason: 'route disappeared before transmit' })
      pending.set(message.requestId, { frame, buffer, values: new Map(), key })
      targets.set(key, message.requestId)
      return emit(frame)
    },
    ingestEnvelope(envelope) {
      if (envelope?.messageName !== 'PARAM_VALUE') return null
      const requestId = targets.get(targetKey(envelope.sysId, envelope.compId))
      if (requestId === undefined) return null
      const item = pending.get(requestId)
      const value = envelope.payload?.paramValue
      if (value === undefined || value.paramCount < 1 || value.paramIndex >= value.paramCount) return null
      item.values.set(value.paramIndex, value)
      const expectedCount = value.paramCount
      const complete = item.values.size === expectedCount && [...item.values.keys()].every((index) => index < expectedCount)
      const frame = { ...item.frame, status: complete ? 'complete' : 'pending', receivedCount: item.values.size,
        expectedCount, parameters: complete ? [...item.values.values()].sort((a, b) => a.paramIndex - b.paramIndex) : [],
        latest: complete ? null : value, updatedAtMs: now() }
      item.frame = frame
      if (complete) { pending.delete(requestId); targets.delete(item.key) }
      // Record bounded start/final lifecycle only; raw PARAM_VALUE bytes preserve progress for replay.
      return emit(frame, complete)
    },
    tick(nowMs = now()) {
      const frames = []
      pending.forEach((item, requestId) => {
        if (nowMs - item.frame.updatedAtMs < idleTimeoutMs) return
        if (item.frame.attempts <= maxRetries && canSend(item.frame.sysId, item.frame.compId)
          && send(item.frame.sysId, item.frame.compId, item.buffer) !== false) {
          item.frame = { ...item.frame, attempts: item.frame.attempts + 1, updatedAtMs: nowMs }
          frames.push(emit(item.frame)); return
        }
        pending.delete(requestId); targets.delete(item.key)
        frames.push(emit({ ...item.frame, status: 'failed', reason: 'parameter list idle timeout', updatedAtMs: nowMs }))
      })
      return frames
    },
    ingestRecordedEvent(frame) {
      if (frame?.type !== 'parameterList' || typeof frame.requestId !== 'string') return null
      cache.set(frame.requestId, frame); return frame
    },
    snapshotForNewClient: () => [...cache.values()],
  }
}
