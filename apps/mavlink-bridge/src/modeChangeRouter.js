import { encodeModeChange, MAV_CMD_DO_SET_MODE } from './modeChangeProtocol.js'

const MAV_TYPE_FIXED_WING = 1
const MAV_TYPE_QUADROTOR = 2
const MODE_POLICIES = new Map([
  [MAV_TYPE_QUADROTOR, new Map([['STABILIZE', 0], ['LOITER', 5]])],
  [MAV_TYPE_FIXED_WING, new Map([['MANUAL', 0], ['LOITER', 12]])],
])
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
const key = (sysId, compId) => `${sysId}:${compId}`

/** Disarmed-only, exact-target mode transition with ACK and HEARTBEAT post-condition. */
export function createModeChangeRouter({ send, canSend, getFlightState,
  enabled = () => false, isLive = () => true, recordEvent = () => {}, now = Date.now,
  ackTimeoutMs = 3000, observationTimeoutMs = 5000, maxRetries = 1,
  gcsSysId = 255, gcsCompId = 190 } = {}) {
  const pending = new Map(), targets = new Map(), cache = new Map()
  const emit = (frame) => { cache.set(frame.requestId, frame); recordEvent(frame); return frame }
  const failure = (m, reason) => ({ type: 'modeChange', requestId: typeof m?.requestId === 'string' ? m.requestId : null,
    sysId: validId(m?.sysId) ? m.sysId : null, compId: validId(m?.compId) ? m.compId : null,
    mode: typeof m?.mode === 'string' ? m.mode : null, customMode: null,
    actor: typeof m?.actor === 'string' ? m.actor : null,
    requestedAtMs: Number.isFinite(m?.timestampMs) ? m.timestampMs : null,
    confirmation: m?.confirmation === true, status: 'failed', ackResult: null,
    observed: false, attempts: 0, reason, updatedAtMs: now() })
  const remove = (requestId, item) => { pending.delete(requestId); targets.delete(key(item.frame.sysId, item.frame.compId)) }
  const finish = (requestId, item) => {
    if (item.frame.ackResult !== 0 || !item.frame.observed) return emit(item.frame)
    remove(requestId, item)
    item.frame = { ...item.frame, status: 'complete', reason: null, updatedAtMs: now() }
    return emit(item.frame)
  }

  return {
    handleClientMessage(m) {
      if (m?.type !== 'setMode') return null
      if (!enabled()) return failure(m, 'mode changes are disabled')
      if (!isLive()) return failure(m, 'replay mode: mode changes are disabled')
      if (typeof m.requestId !== 'string' || !m.requestId || !validId(m.sysId) || !validId(m.compId)) return failure(m, 'invalid request or target')
      if (typeof m.actor !== 'string' || !m.actor.trim() || !Number.isFinite(m.timestampMs) || m.confirmation !== true) return failure(m, 'actor, timestamp, and explicit confirmation are required')
      if (cache.has(m.requestId)) return failure(m, 'duplicate requestId')
      const target = key(m.sysId, m.compId)
      if (targets.has(target)) return failure(m, 'mode change already pending for target')
      if (!canSend(m.sysId, m.compId)) return failure(m, 'no live UDP endpoint for requested system')
      const state = getFlightState(m.sysId, m.compId)
      if (state === null || state === undefined) return failure(m, 'fresh HEARTBEAT state is required')
      if (state.armed) return failure(m, 'mode changes are limited to disarmed vehicles')
      const policy = MODE_POLICIES.get(state.vehicleType)
      if (policy === undefined || !policy.has(m.mode)) return failure(m, 'mode is not allowlisted for observed vehicle type')
      const customMode = policy.get(m.mode)
      if (state.customMode === customMode) return failure(m, 'vehicle is already in requested mode')
      const buffer = encodeModeChange({ sysId: gcsSysId, compId: gcsCompId,
        targetSystemId: m.sysId, targetComponentId: m.compId, customMode })
      const frame = { ...failure(m, null), customMode, status: 'awaitingAck', reason: null,
        attempts: 1, updatedAtMs: now() }
      if (send(m.sysId, m.compId, buffer) === false) return emit({ ...frame, status: 'failed', reason: 'route disappeared before transmit' })
      pending.set(m.requestId, { frame, buffer }); targets.set(target, m.requestId)
      return emit(frame)
    },

    ingestEnvelope(envelope) {
      const requestId = targets.get(key(envelope?.sysId, envelope?.compId))
      if (requestId === undefined) return null
      const item = pending.get(requestId)
      if (envelope.messageName === 'COMMAND_ACK' && envelope.payload?.commandAck?.command === MAV_CMD_DO_SET_MODE) {
        const result = envelope.payload.commandAck.result
        if (result !== 0) { remove(requestId, item); return emit({ ...item.frame, status: 'failed', ackResult: result,
          reason: `COMMAND_ACK result ${result}`, updatedAtMs: now() }) }
        item.frame = { ...item.frame, ackResult: 0,
          status: item.frame.observed ? item.frame.status : 'awaitingObservation', updatedAtMs: now() }
        return finish(requestId, item)
      }
      if (envelope.messageName === 'HEARTBEAT') {
        const heartbeat = envelope.payload?.heartbeat
        if (heartbeat?.armed === true) { remove(requestId, item); return emit({ ...item.frame, status: 'failed',
          reason: 'vehicle armed before mode post-condition completed', updatedAtMs: now() }) }
        if (heartbeat?.customMode !== item.frame.customMode) return null
        item.frame = { ...item.frame, observed: true,
          status: item.frame.ackResult === 0 ? item.frame.status : 'awaitingAck', updatedAtMs: now() }
        return finish(requestId, item)
      }
      return null
    },

    tick(atMs = now()) {
      const out = []
      pending.forEach((item, requestId) => {
        const timeout = item.frame.ackResult === null ? ackTimeoutMs : observationTimeoutMs
        if (atMs - item.frame.updatedAtMs < timeout) return
        if (item.frame.ackResult === null && item.frame.attempts <= maxRetries && canSend(item.frame.sysId, item.frame.compId)
          && send(item.frame.sysId, item.frame.compId, item.buffer) !== false) {
          item.frame = emit({ ...item.frame, attempts: item.frame.attempts + 1, updatedAtMs: atMs })
          out.push(item.frame); return
        }
        remove(requestId, item)
        const reason = canSend(item.frame.sysId, item.frame.compId)
          ? (item.frame.ackResult === null ? 'COMMAND_ACK timeout' : 'HEARTBEAT mode observation timeout')
          : 'target route became stale during mode change'
        out.push(emit({ ...item.frame, status: 'failed', reason, updatedAtMs: atMs }))
      })
      return out
    },
    ingestRecordedEvent(frame) { if (frame?.type !== 'modeChange') return null; cache.set(frame.requestId, frame); return frame },
    snapshotForNewClient: () => [...cache.values()],
  }
}
