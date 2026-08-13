import { prepareGuidedReposition } from './guidedRepositionPolicy.js'
import { observesGuidedTarget } from './guidedRepositionObservation.js'
import { MAV_CMD_DO_REPOSITION } from './guidedRepositionProtocol.js'

const key = (sysId, compId) => `${sysId}:${compId}`
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255

/** Disabled, isolated-SITL transaction layer; intentionally not registered by index.js. */
export function createGuidedRepositionRouter({ send, canSend, getFlightState,
  enabled = () => false, isIsolatedSitl = () => false, isLive = () => true,
  recordEvent = () => {}, now = Date.now, ackTimeoutMs = 3000,
  observationTimeoutMs = 120000, maxRetries = 0, gcsSysId = 255, gcsCompId = 190 } = {}) {
  const pending = new Map(), targets = new Map(), cache = new Map()
  const emit = (frame) => { cache.set(frame.requestId, frame); recordEvent(frame); return frame }
  const failure = (request, reason) => ({ type: 'guidedReposition',
    requestId: typeof request?.requestId === 'string' ? request.requestId : null,
    sysId: validId(request?.sysId) ? request.sysId : null,
    compId: validId(request?.compId) ? request.compId : null,
    status: 'failed', ackResult: null, observed: false, attempts: 0,
    horizontalDistanceM: null, altitudeErrorM: null, reason, updatedAtMs: now() })
  const remove = (requestId, item) => {
    pending.delete(requestId); targets.delete(key(item.frame.sysId, item.frame.compId))
  }
  const finish = (requestId, item) => {
    if (item.frame.ackResult !== 0 || !item.frame.observed) return emit(item.frame)
    remove(requestId, item)
    item.frame = { ...item.frame, status: 'complete', reason: null, updatedAtMs: now() }
    return emit(item.frame)
  }
  const failPending = (requestId, item, reason) => {
    remove(requestId, item)
    item.frame = { ...item.frame, status: 'failed', reason, updatedAtMs: now() }
    return emit(item.frame)
  }

  return {
    handleClientMessage(request) {
      if (request?.type !== 'guidedReposition') return null
      if (!enabled()) return failure(request, 'Guided reposition is disabled')
      if (!isIsolatedSitl()) return failure(request, 'Guided reposition requires an attested isolated SITL environment')
      if (!isLive()) return failure(request, 'replay mode: Guided reposition is disabled')
      if (cache.has(request.requestId)) return failure(request, 'duplicate requestId')
      const target = key(request.sysId, request.compId)
      if (targets.has(target)) return failure(request, 'Guided reposition already pending for target')
      if (!canSend(request.sysId, request.compId)) return failure(request, 'no live UDP endpoint for requested system')
      const prepared = prepareGuidedReposition({ request,
        flightState: getFlightState(request.sysId, request.compId), gcsSysId, gcsCompId })
      if (!prepared.accepted) return failure(request, prepared.reason)
      const { buffer, ...command } = prepared.command
      const frame = { ...failure(request, null), ...command, status: 'awaitingAck', reason: null,
        attempts: 1, updatedAtMs: now() }
      if (send(request.sysId, request.compId, buffer) === false) return emit({ ...frame,
        status: 'failed', reason: 'route disappeared before transmit' })
      pending.set(request.requestId, { frame, buffer }); targets.set(target, request.requestId)
      return emit(frame)
    },

    ingestEnvelope(envelope) {
      const requestId = targets.get(key(envelope?.sysId, envelope?.compId))
      if (requestId === undefined) return null
      const item = pending.get(requestId)
      if (envelope.messageName === 'COMMAND_ACK'
        && envelope.payload?.commandAck?.command === MAV_CMD_DO_REPOSITION) {
        const result = envelope.payload.commandAck.result
        if (result !== 0) {
          item.frame = { ...item.frame, ackResult: result }
          return failPending(requestId, item, `COMMAND_ACK result ${result}`)
        }
        item.frame = { ...item.frame, ackResult: 0,
          status: item.frame.observed ? item.frame.status : 'awaitingObservation', updatedAtMs: now() }
        return finish(requestId, item)
      }
      if (envelope.messageName === 'HEARTBEAT') {
        const heartbeat = envelope.payload?.heartbeat
        if (heartbeat?.armed !== true) return failPending(requestId, item, 'vehicle disarmed before Guided post-condition completed')
        if (heartbeat.customMode !== item.frame.guidedCustomMode) return failPending(requestId, item, 'vehicle left Guided mode before post-condition completed')
        return null
      }
      if (envelope.messageName !== 'GLOBAL_POSITION_INT') return null
      const observation = observesGuidedTarget(envelope.payload?.globalPositionInt, item.frame)
      if (observation === null || !observation.arrived) return null
      item.frame = { ...item.frame, observed: true,
        horizontalDistanceM: observation.horizontalDistanceM,
        altitudeErrorM: observation.altitudeErrorM,
        status: item.frame.ackResult === 0 ? item.frame.status : 'awaitingAck', updatedAtMs: now() }
      return finish(requestId, item)
    },

    tick(atMs = now()) {
      const out = []
      pending.forEach((item, requestId) => {
        const timeout = item.frame.ackResult === null ? ackTimeoutMs : observationTimeoutMs
        if (atMs - item.frame.updatedAtMs < timeout) return
        if (item.frame.ackResult === null && item.frame.attempts <= maxRetries
          && canSend(item.frame.sysId, item.frame.compId)
          && send(item.frame.sysId, item.frame.compId, item.buffer) !== false) {
          item.frame = emit({ ...item.frame, attempts: item.frame.attempts + 1, updatedAtMs: atMs })
          out.push(item.frame); return
        }
        const reason = canSend(item.frame.sysId, item.frame.compId)
          ? (item.frame.ackResult === null ? 'COMMAND_ACK timeout' : 'GLOBAL_POSITION_INT observation timeout')
          : 'target route became stale during Guided reposition'
        out.push(failPending(requestId, item, reason))
      })
      return out
    },
    ingestRecordedEvent(frame) {
      if (frame?.type !== 'guidedReposition') return null
      cache.set(frame.requestId, frame); return frame
    },
    snapshotForNewClient: () => [...cache.values()],
  }
}
