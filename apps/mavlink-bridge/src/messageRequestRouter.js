import { encodeMessageRequest, MAV_CMD_REQUEST_MESSAGE } from './messageRequestProtocol.js'
const ALLOWED = new Map([['HOME_POSITION', 242], ['GPS_GLOBAL_ORIGIN', 49]])
const key = (s, c) => `${s}:${c}`
const id = (v) => Number.isInteger(v) && v > 0 && v <= 255
export function createMessageRequestRouter({ send, canSend, isLive = () => true, recordEvent = () => {}, now = Date.now, timeoutMs = 3000 } = {}) {
  const pending = new Map(), targets = new Map(), cache = new Map()
  const emit = (f) => { cache.set(f.requestId, f); recordEvent(f); return f }
  const fail = (m, reason) => ({ type: 'messageRequest', requestId: typeof m?.requestId === 'string' ? m.requestId : null, sysId: id(m?.sysId) ? m.sysId : null, compId: id(m?.compId) ? m.compId : null, messageName: typeof m?.messageName === 'string' ? m.messageName : null, status: 'failed', ackResult: null, response: null, reason, updatedAtMs: now() })
  const finish = (requestId, item) => {
    if (item.ackResult === null || item.response === null) return emit(item)
    pending.delete(requestId); targets.delete(key(item.sysId, item.compId))
    return emit({ ...item, status: 'complete', updatedAtMs: now() })
  }
  return {
    handleClientMessage(m) {
      if (m?.type !== 'requestMessage') return null
      if (typeof m.requestId !== 'string' || !m.requestId || !id(m.sysId) || !id(m.compId)) return fail(m, 'invalid request or target')
      if (!ALLOWED.has(m.messageName)) return fail(m, 'message is not allowlisted')
      if (!isLive()) return fail(m, 'replay mode: no live vehicle to query')
      if (!canSend(m.sysId, m.compId)) return fail(m, 'no live UDP endpoint for requested system')
      if (cache.has(m.requestId)) return fail(m, 'duplicate requestId')
      const k = key(m.sysId, m.compId); if (targets.has(k)) return fail(m, 'message request already pending for target')
      const buffer = encodeMessageRequest({ sysId: 255, compId: 190, targetSystemId: m.sysId, targetComponentId: m.compId, messageId: ALLOWED.get(m.messageName) })
      const frame = { ...fail(m, null), status: 'pending', reason: null, updatedAtMs: now() }
      if (send(m.sysId, m.compId, buffer) === false) return emit({ ...frame, status: 'failed', reason: 'route disappeared before transmit' })
      pending.set(m.requestId, frame); targets.set(k, m.requestId); return emit(frame)
    },
    ingestEnvelope(e) {
      const requestId = targets.get(key(e.sysId, e.compId)); if (!requestId) return null
      let item = pending.get(requestId)
      if (e.messageName === 'COMMAND_ACK' && e.payload?.commandAck?.command === MAV_CMD_REQUEST_MESSAGE) {
        const result = e.payload.commandAck.result
        if (result !== 0) { pending.delete(requestId); targets.delete(key(e.sysId, e.compId)); return emit({ ...item, status: 'failed', ackResult: result, reason: `COMMAND_ACK result ${result}`, updatedAtMs: now() }) }
        item = { ...item, ackResult: result }; pending.set(requestId, item); return finish(requestId, item)
      }
      if (e.messageName === item.messageName) { item = { ...item, response: e.payload }; pending.set(requestId, item); return finish(requestId, item) }
      return null
    },
    tick(t = now()) { const out=[]; pending.forEach((v,r)=>{if(t-v.updatedAtMs>=timeoutMs){pending.delete(r);targets.delete(key(v.sysId,v.compId));out.push(emit({...v,status:'failed',reason:v.ackResult===null?'ack timeout':'response timeout',updatedAtMs:t}))}}); return out },
    ingestRecordedEvent(f) { if(f?.type!=='messageRequest') return null; cache.set(f.requestId,f); return f },
    snapshotForNewClient: () => [...cache.values()],
  }
}
