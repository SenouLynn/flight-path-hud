import { encodeGuidedLand, MAV_CMD_NAV_LAND } from './guidedLandProtocol.js'

const key = (s, c) => `${s}:${c}`
const validId = (v) => Number.isInteger(v) && v > 0 && v <= 255

/** Copter-only landing with command ACK and a bounded relative-altitude touchdown observation. */
export function createGuidedLandRouter({ send, canSend, getFlightState,
  enabled = () => false, isIsolatedSitl = () => false, isLive = () => true,
  recordEvent = () => {}, now = Date.now, ackTimeoutMs = 3000,
  observationTimeoutMs = 60000, touchdownAltitudeM = 0.75,
  gcsSysId = 255, gcsCompId = 190 } = {}) {
  const pending = new Map(), targets = new Map(), cache = new Map()
  const emit = (f) => { if (f.requestId) cache.set(f.requestId, f); recordEvent(f); return f }
  const failure = (m, reason) => ({ type: 'guidedLand', requestId: typeof m?.requestId === 'string' ? m.requestId : null,
    sysId: validId(m?.sysId) ? m.sysId : null, compId: validId(m?.compId) ? m.compId : null,
    touchdownAltitudeM, status: 'failed', ackResult: null, observed: false, attempts: 0,
    relativeAltitudeM: null, reason, updatedAtMs: now() })
  const remove = (id, item) => { pending.delete(id); targets.delete(key(item.frame.sysId, item.frame.compId)) }
  return {
    handleClientMessage(m) {
      if (m?.type !== 'guidedLand') return null
      if (!enabled()) return failure(m, 'Guided landing is disabled')
      if (!isIsolatedSitl()) return failure(m, 'Guided landing requires an attested isolated SITL environment')
      if (!isLive()) return failure(m, 'replay mode: Guided landing is disabled')
      if (!validId(m.sysId) || !validId(m.compId) || typeof m.requestId !== 'string' || !m.requestId) return failure(m, 'invalid request or target')
      if (!m.actor?.trim() || !Number.isFinite(m.timestampMs) || m.confirmation !== true
        || m.safetyCase !== 'isolated-sitl-guided') return failure(m, 'actor, timestamp, confirmation, and isolated-SITL safety case are required')
      if (cache.has(m.requestId)) return failure(m, 'duplicate requestId')
      const target = key(m.sysId, m.compId)
      if (targets.has(target)) return failure(m, 'landing already pending for target')
      if (!canSend(m.sysId, m.compId)) return failure(m, 'no live UDP endpoint for requested system')
      const state = getFlightState(m.sysId, m.compId)
      if (!state || state.autopilotType !== 3 || state.vehicleType !== 2 || !state.armed || state.customMode !== 4) {
        return failure(m, 'fresh armed ArduCopter GUIDED state is required')
      }
      const buffer = encodeGuidedLand({ sysId: gcsSysId, compId: gcsCompId,
        targetSystemId: m.sysId, targetComponentId: m.compId })
      const frame = { ...failure(m, null), status: 'awaitingAck', reason: null, attempts: 1 }
      if (send(m.sysId, m.compId, buffer) === false) return emit({ ...frame, status: 'failed', reason: 'route disappeared before transmit' })
      pending.set(m.requestId, { frame }); targets.set(target, m.requestId); return emit(frame)
    },
    ingestEnvelope(envelope) {
      const id = targets.get(key(envelope?.sysId, envelope?.compId)); if (!id) return null
      const item = pending.get(id)
      if (envelope.messageName === 'HEARTBEAT' && envelope.payload?.heartbeat?.armed !== true) {
        remove(id, item); return emit({ ...item.frame, status: 'failed', reason: 'vehicle disarmed before touchdown was verified', updatedAtMs: now() })
      }
      if (envelope.messageName === 'COMMAND_ACK' && envelope.payload?.commandAck?.command === MAV_CMD_NAV_LAND) {
        const result = envelope.payload.commandAck.result
        if (result !== 0) { remove(id, item); return emit({ ...item.frame, status: 'failed', ackResult: result, reason: `COMMAND_ACK result ${result}`, updatedAtMs: now() }) }
        item.frame = { ...item.frame, ackResult: 0, status: item.frame.observed ? 'complete' : 'awaitingObservation', updatedAtMs: now() }
        if (item.frame.observed) remove(id, item); return emit(item.frame)
      }
      if (envelope.messageName === 'GLOBAL_POSITION_INT') {
        const altitude = envelope.payload?.globalPositionInt?.relativeAltMm / 1000
        if (!Number.isFinite(altitude)) return null
        const touchedDown = altitude <= touchdownAltitudeM
        item.frame = { ...item.frame, relativeAltitudeM: altitude, observed: touchedDown,
          status: touchedDown && item.frame.ackResult === 0 ? 'complete' : item.frame.status,
          ...(touchedDown ? { updatedAtMs: now() } : {}) }
        if (item.frame.status === 'complete') remove(id, item); return emit(item.frame)
      }
      return null
    },
    tick(atMs = now()) { const out = []; pending.forEach((item, id) => {
      const timeout = item.frame.ackResult === null ? ackTimeoutMs : observationTimeoutMs
      if (atMs - item.frame.updatedAtMs < timeout) return
      remove(id, item); out.push(emit({ ...item.frame, status: 'failed',
        reason: canSend(item.frame.sysId, item.frame.compId) ? (item.frame.ackResult === null ? 'COMMAND_ACK timeout' : 'touchdown observation timeout') : 'target route became stale during landing', updatedAtMs: atMs }))
    }); return out },
    ingestRecordedEvent(frame) { if (frame?.type !== 'guidedLand') return null; cache.set(frame.requestId, frame); return frame },
    snapshotForNewClient: () => [...cache.values()],
  }
}
