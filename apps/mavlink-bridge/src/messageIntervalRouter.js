import { encodeSetMessageInterval, MAV_CMD_SET_MESSAGE_INTERVAL } from './messageRequestProtocol.js'

const MESSAGES = new Map([['ATTITUDE',30],['GLOBAL_POSITION_INT',33],['VFR_HUD',74],['GPS_RAW_INT',24]])
const validId = value => Number.isInteger(value) && value > 0 && value <= 255
const key = (sysId, compId) => `${sysId}:${compId}`

/** Reversible SET_MESSAGE_INTERVAL transaction; disabled unless its edge adapter enables it. */
export function createMessageIntervalRouter({ send, canSend, enabled = () => false, isLive = () => true,
  recordEvent = () => {}, now = Date.now, ackTimeoutMs = 3000, observationTimeoutMs = 5000 } = {}) {
  const pending = new Map(), targets = new Map(), cache = new Map()
  const emit = frame => { cache.set(frame.requestId, frame); recordEvent(frame); return frame }
  const failure = (m, reason) => ({ type:'messageInterval', requestId:typeof m?.requestId==='string'?m.requestId:null,
    sysId:validId(m?.sysId)?m.sysId:null, compId:validId(m?.compId)?m.compId:null,
    messageName:typeof m?.messageName==='string'?m.messageName:null, intervalUs:Number.isInteger(m?.intervalUs)?m.intervalUs:null,
    status:'failed', ackResult:null, observed:false, reason, updatedAtMs:now() })
  const remove = (requestId, frame) => { pending.delete(requestId); targets.delete(key(frame.sysId,frame.compId)) }
  return {
    handleClientMessage(m) {
      if (m?.type !== 'setMessageInterval') return null
      if (!enabled()) return failure(m,'message interval configuration is disabled')
      if (!isLive()) return failure(m,'replay mode: commands are disabled')
      if (typeof m.requestId!=='string'||!m.requestId||!validId(m.sysId)||!validId(m.compId)) return failure(m,'invalid request or target')
      if (!MESSAGES.has(m.messageName)) return failure(m,'message is not allowlisted')
      // 100 ms minimum prevents a browser from requesting more than 10 Hz; 0 restores autopilot default, -1 disables.
      if (!Number.isInteger(m.intervalUs) || (m.intervalUs !== -1 && m.intervalUs !== 0 && (m.intervalUs < 100_000 || m.intervalUs > 60_000_000))) return failure(m,'intervalUs must be -1, 0, or 100000-60000000')
      if (cache.has(m.requestId)) return failure(m,'duplicate requestId')
      const target=key(m.sysId,m.compId); if(targets.has(target)) return failure(m,'interval command already pending for target')
      if(!canSend(m.sysId,m.compId)) return failure(m,'no live UDP endpoint for requested system')
      const buffer=encodeSetMessageInterval({sysId:255,compId:190,targetSystemId:m.sysId,targetComponentId:m.compId,messageId:MESSAGES.get(m.messageName),intervalUs:m.intervalUs})
      const frame={...failure(m,null),status:'awaitingAck',reason:null,updatedAtMs:now()}
      if(send(m.sysId,m.compId,buffer)===false)return emit({...frame,status:'failed',reason:'route disappeared before transmit'})
      pending.set(m.requestId,frame);targets.set(target,m.requestId);return emit(frame)
    },
    ingestEnvelope(e) {
      const requestId=targets.get(key(e.sysId,e.compId));if(!requestId)return null
      const item=pending.get(requestId)
      if(e.messageName==='COMMAND_ACK'&&e.payload?.commandAck?.command===MAV_CMD_SET_MESSAGE_INTERVAL){
        const result=e.payload.commandAck.result
        if(result!==0){remove(requestId,item);return emit({...item,status:'failed',ackResult:result,reason:`COMMAND_ACK result ${result}`,updatedAtMs:now()})}
        // Disabled streams have no positive message observation; ACK is their only protocol post-condition.
        if(item.intervalUs===-1){remove(requestId,item);return emit({...item,status:'complete',ackResult:0,reason:null,updatedAtMs:now()})}
        const next={...item,status:'awaitingObservation',ackResult:0,updatedAtMs:now()};pending.set(requestId,next);return emit(next)
      }
      if(item.status==='awaitingObservation'&&e.messageName===item.messageName){remove(requestId,item);return emit({...item,status:'complete',observed:true,reason:null,updatedAtMs:now()})}
      return null
    },
    tick(t=now()){const out=[];pending.forEach((item,id)=>{const limit=item.status==='awaitingAck'?ackTimeoutMs:observationTimeoutMs;if(t-item.updatedAtMs>=limit){remove(id,item);out.push(emit({...item,status:'failed',reason:item.status==='awaitingAck'?'ack timeout':'post-condition observation timeout',updatedAtMs:t}))}});return out},
    ingestRecordedEvent(f){if(f?.type!=='messageInterval')return null;cache.set(f.requestId,f);return f},
    snapshotForNewClient:()=>[...cache.values()],
  }
}
