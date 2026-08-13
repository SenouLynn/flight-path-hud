import { encodeArmDisarm, MAV_CMD_COMPONENT_ARM_DISARM } from './armDisarmProtocol.js'

const MAV_AUTOPILOT_ARDUPILOTMEGA = 3
const SUPPORTED_VEHICLE_TYPES = new Set([1, 2]) // fixed wing, quadrotor: current mixed-SITL fleet only
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
const key = (sysId, compId) => `${sysId}:${compId}`

/** Standard (never forced) arm/disarm, available only in an attested isolated SITL environment. */
export function createArmDisarmRouter({ send, canSend, getFlightState,
  enabled = () => false, isIsolatedSitl = () => false, isLive = () => true,
  recordEvent = () => {}, now = Date.now, ackTimeoutMs = 3000,
  observationTimeoutMs = 5000, maxRetries = 0, gcsSysId = 255, gcsCompId = 190 } = {}) {
  const pending = new Map(), targets = new Map(), cache = new Map()
  const emit = (frame) => { cache.set(frame.requestId, frame); recordEvent(frame); return frame }
  const failure = (m, reason) => ({ type: 'armDisarm', requestId: typeof m?.requestId === 'string' ? m.requestId : null,
    sysId: validId(m?.sysId) ? m.sysId : null, compId: validId(m?.compId) ? m.compId : null,
    arm: typeof m?.arm === 'boolean' ? m.arm : null, actor: typeof m?.actor === 'string' ? m.actor : null,
    requestedAtMs: Number.isFinite(m?.timestampMs) ? m.timestampMs : null,
    confirmation: m?.confirmation === true, safetyCase: m?.safetyCase === 'sitl-no-propulsion' ? m.safetyCase : null,
    status: 'failed', ackResult: null, observed: false, attempts: 0, reason, updatedAtMs: now() })
  const remove = (requestId, item) => { pending.delete(requestId); targets.delete(key(item.frame.sysId, item.frame.compId)) }
  const finish = (requestId, item) => {
    if (item.frame.ackResult !== 0 || !item.frame.observed) return emit(item.frame)
    remove(requestId, item)
    item.frame = { ...item.frame, status: 'complete', reason: null, updatedAtMs: now() }
    return emit(item.frame)
  }

  return {
    handleClientMessage(m) {
      if (m?.type !== 'setArmed') return null
      if (!enabled()) return failure(m, 'arm/disarm commands are disabled')
      if (!isIsolatedSitl()) return failure(m, 'arm/disarm requires an attested isolated SITL environment')
      if (!isLive()) return failure(m, 'replay mode: arm/disarm commands are disabled')
      if (typeof m.requestId !== 'string' || !m.requestId || !validId(m.sysId) || !validId(m.compId) || typeof m.arm !== 'boolean') return failure(m, 'invalid request, target, or arm value')
      if (typeof m.actor !== 'string' || !m.actor.trim() || !Number.isFinite(m.timestampMs)
        || m.confirmation !== true || m.safetyCase !== 'sitl-no-propulsion') return failure(m, 'actor, timestamp, explicit confirmation, and sitl-no-propulsion safety case are required')
      if (cache.has(m.requestId)) return failure(m, 'duplicate requestId')
      const target = key(m.sysId, m.compId)
      if (targets.has(target)) return failure(m, 'arm/disarm transaction already pending for target')
      if (!canSend(m.sysId, m.compId)) return failure(m, 'no live UDP endpoint for requested system')
      const state = getFlightState(m.sysId, m.compId)
      if (state === null || state === undefined) return failure(m, 'fresh HEARTBEAT state is required')
      if (state.autopilotType !== MAV_AUTOPILOT_ARDUPILOTMEGA || !SUPPORTED_VEHICLE_TYPES.has(state.vehicleType)) return failure(m, 'observed autopilot/vehicle type is not allowlisted')
      if (state.armed === m.arm) return failure(m, `vehicle is already ${m.arm ? 'armed' : 'disarmed'}`)
      const buffer = encodeArmDisarm({ sysId: gcsSysId, compId: gcsCompId,
        targetSystemId: m.sysId, targetComponentId: m.compId, arm: m.arm })
      const frame = { ...failure(m, null), status: 'awaitingAck', reason: null, attempts: 1, updatedAtMs: now() }
      if (send(m.sysId, m.compId, buffer) === false) return emit({ ...frame, status: 'failed', reason: 'route disappeared before transmit' })
      pending.set(m.requestId, { frame, buffer }); targets.set(target, m.requestId)
      return emit(frame)
    },

    ingestEnvelope(envelope) {
      const requestId = targets.get(key(envelope?.sysId, envelope?.compId))
      if (requestId === undefined) return null
      const item = pending.get(requestId)
      if (envelope.messageName === 'COMMAND_ACK' && envelope.payload?.commandAck?.command === MAV_CMD_COMPONENT_ARM_DISARM) {
        const result = envelope.payload.commandAck.result
        if (result !== 0) { remove(requestId, item); return emit({ ...item.frame, status: 'failed', ackResult: result,
          reason: `COMMAND_ACK result ${result}`, updatedAtMs: now() }) }
        item.frame = { ...item.frame, ackResult: 0,
          status: item.frame.observed ? item.frame.status : 'awaitingObservation', updatedAtMs: now() }
        return finish(requestId, item)
      }
      if (envelope.messageName === 'HEARTBEAT' && envelope.payload?.heartbeat?.armed === item.frame.arm) {
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
        // Default is deliberately zero retries for arming. Tests may inject a bounded retry budget.
        if (item.frame.ackResult === null && item.frame.attempts <= maxRetries && canSend(item.frame.sysId, item.frame.compId)
          && send(item.frame.sysId, item.frame.compId, item.buffer) !== false) {
          item.frame = emit({ ...item.frame, attempts: item.frame.attempts + 1, updatedAtMs: atMs })
          out.push(item.frame); return
        }
        remove(requestId, item)
        const reason = canSend(item.frame.sysId, item.frame.compId)
          ? (item.frame.ackResult === null ? 'COMMAND_ACK timeout' : 'HEARTBEAT armed-state observation timeout')
          : 'target route became stale during arm/disarm'
        out.push(emit({ ...item.frame, status: 'failed', reason, updatedAtMs: atMs }))
      })
      return out
    },
    ingestRecordedEvent(frame) { if (frame?.type !== 'armDisarm') return null; cache.set(frame.requestId, frame); return frame },
    snapshotForNewClient: () => [...cache.values()],
  }
}
