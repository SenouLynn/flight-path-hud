import { createMissionSync } from './missionSync.js'
import { createMissionUpload } from './missionUpload.js'

const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
const targetKey = (sysId, compId) => `${sysId}:${compId}`

/** Disabled-by-default policy and lifecycle boundary for full mission replacement. */
export function createMissionUploadRouter({ send, canSend, enabled = () => false,
  isLive = () => true, recordEvent = () => {}, now = Date.now,
  gcsSysId = 255, gcsCompId = 190, timeoutMs, maxRetries } = {}) {
  const pending = new Map(), pendingTargets = new Map(), cache = new Map()

  const emit = (frame) => { cache.set(frame.requestId, frame); recordEvent(frame); return frame }
  const baseFrame = (message) => ({
    type: 'missionUpload', requestId: typeof message?.requestId === 'string' ? message.requestId : null,
    sysId: validId(message?.sysId) ? message.sysId : null,
    compId: validId(message?.compId) ? message.compId : null,
    actor: typeof message?.actor === 'string' ? message.actor : null,
    requestedAtMs: Number.isFinite(message?.timestampMs) ? message.timestampMs : null,
    confirmation: message?.confirmation === true,
    policy: message?.policy === 'clearThenReplace' ? message.policy : null,
    itemCount: Array.isArray(message?.items) ? message.items.length : null,
  })
  const reject = (message, reason) => {
    const frame = { ...baseFrame(message), status: 'rejected', requestedCount: 0,
      reason, updatedAtMs: now() }
    if (frame.requestId !== null) recordEvent(frame)
    return frame
  }
  const remove = (requestId, item) => {
    pending.delete(requestId)
    pendingTargets.delete(item.key)
  }
  const stateFrame = (item) => {
    const state = item.upload.getState()
    return { ...item.frame, status: state.status, requestedCount: state.requestedCount,
      reason: state.reason, updatedAtMs: now() }
  }
  const boundSend = (sysId, compId) => (buffer) => {
    if (!canSend(sysId, compId)) return false
    return send(sysId, compId, buffer)
  }

  function beginReadback(item) {
    item.readback = createMissionSync({
      send: boundSend(item.frame.sysId, item.frame.compId), now,
      sysId: gcsSysId, compId: gcsCompId,
      targetSystemId: item.frame.sysId, targetComponentId: item.frame.compId,
    })
    item.readback.requestMission()
  }

  function finishIfTerminal(requestId, item) {
    const frame = emit(stateFrame(item))
    if (['complete', 'failed'].includes(frame.status)) remove(requestId, item)
    return frame
  }

  return {
    handleClientMessage(message) {
      if (message?.type !== 'uploadMission') return null
      if (!enabled()) return reject(message, 'mission uploads are disabled')
      if (!isLive()) return reject(message, 'replay mode: mission uploads are disabled')
      if (typeof message.requestId !== 'string' || message.requestId.trim() === '') return reject(message, 'invalid requestId')
      if (!validId(message.sysId) || !validId(message.compId)) return reject(message, 'invalid target: expected non-broadcast uint8 sysId/compId')
      if (typeof message.actor !== 'string' || message.actor.trim() === '') return reject(message, 'actor is required')
      if (!Number.isFinite(message.timestampMs) || message.confirmation !== true) return reject(message, 'timestamp and explicit confirmation are required')
      if (message.policy !== 'clearThenReplace') return reject(message, 'clearThenReplace policy is required')
      if (cache.has(message.requestId) || pending.has(message.requestId)) return reject(message, 'duplicate requestId')
      const key = targetKey(message.sysId, message.compId)
      if (pendingTargets.has(key)) return reject(message, 'mission upload already pending for target')
      if (!canSend(message.sysId, message.compId)) return reject(message, 'no live UDP endpoint for requested system')

      const item = { key, frame: { ...baseFrame(message), status: 'idle', requestedCount: 0,
        reason: null, updatedAtMs: now() }, upload: null, readback: null }
      try {
        item.upload = createMissionUpload({ send: boundSend(message.sysId, message.compId), now,
          sysId: gcsSysId, compId: gcsCompId, targetSystemId: message.sysId,
          targetComponentId: message.compId, timeoutMs, maxRetries })
        item.upload.start(message.items)
      } catch (error) {
        return reject(message, `invalid mission: ${error?.message ?? error}`)
      }
      pending.set(message.requestId, item); pendingTargets.set(key, message.requestId)
      return finishIfTerminal(message.requestId, item)
    },

    ingestEnvelope(envelope) {
      const requestId = pendingTargets.get(targetKey(envelope?.sysId, envelope?.compId))
      if (requestId === undefined) return null
      const item = pending.get(requestId)

      if (item.readback !== null) {
        if (!item.readback.ingestEnvelope(envelope)) return null
        if (item.readback.getState().status !== 'complete') return emit(stateFrame(item))
        item.upload.confirmReadback(item.readback.getState().items)
        return finishIfTerminal(requestId, item)
      }

      if (!item.upload.ingestEnvelope(envelope)) return null
      if (item.upload.getState().status === 'awaitingReadback') beginReadback(item)
      return finishIfTerminal(requestId, item)
    },

    tick(nowMs = now()) {
      const frames = []
      pending.forEach((item, requestId) => {
        if (!canSend(item.frame.sysId, item.frame.compId)) {
          if (item.upload.abort('target route became stale during mission upload')) frames.push(finishIfTerminal(requestId, item))
          return
        }
        const changed = item.readback === null ? item.upload.tick(nowMs) : item.readback.tick(nowMs)
        if (!changed) return
        if (item.readback?.getState().status === 'failed') item.upload.abort(`mission read-back failed: ${item.readback.getState().reason}`)
        frames.push(finishIfTerminal(requestId, item))
      })
      return frames
    },

    ingestRecordedEvent(frame) {
      if (frame?.type !== 'missionUpload' || typeof frame.requestId !== 'string') return null
      cache.set(frame.requestId, frame)
      return frame
    },
    snapshotForNewClient: () => [...cache.values()],
  }
}
