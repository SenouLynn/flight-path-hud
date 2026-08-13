import { encodeParameterSet } from './parameterProtocol.js'

const ALLOWLIST = new Map([['LOG_DISARMED', { minimum: 0, maximum: 1, paramType: 2 }]])
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
const key = (sysId, compId, name) => `${sysId}:${compId}:${name}`

/** Narrow PARAM_SET transaction. Policy is code-owned, never client supplied. */
export function createParameterWriteRouter({ send, canSend, enabled = () => false, isLive = () => true,
  recordEvent = () => {}, now = Date.now, timeoutMs = 1500, maxRetries = 2,
  gcsSysId = 255, gcsCompId = 190 } = {}) {
  const pending = new Map(), pendingKeys = new Map(), cache = new Map()
  const emit = (frame) => { cache.set(frame.requestId, frame); recordEvent(frame); return frame }
  const failure = (m, reason) => ({ type:'parameterWrite', requestId:typeof m?.requestId==='string'?m.requestId:null,
    sysId:validId(m?.sysId)?m.sysId:null, compId:validId(m?.compId)?m.compId:null,
    name:typeof m?.name==='string'?m.name:null, requestedValue:Number.isFinite(m?.value)?m.value:null,
    actor:typeof m?.actor==='string'?m.actor:null, requestedAtMs:Number.isFinite(m?.timestampMs)?m.timestampMs:null,
    confirmation:m?.confirmation===true, status:'failed', observedValue:null, reason, updatedAtMs:now() })
  const remove = (requestId, item) => { pending.delete(requestId); pendingKeys.delete(item.key) }
  return {
    handleClientMessage(m) {
      if (m?.type !== 'writeParameter') return null
      if (!enabled()) return failure(m,'parameter writes are disabled')
      if (!isLive()) return failure(m,'replay mode: writes are disabled')
      if (typeof m.requestId!=='string'||!m.requestId||!validId(m.sysId)||!validId(m.compId)) return failure(m,'invalid request or target')
      if (typeof m.actor!=='string'||!m.actor||!Number.isFinite(m.timestampMs)||m.confirmation!==true) return failure(m,'actor, timestamp, and explicit confirmation are required')
      const policy=ALLOWLIST.get(m.name); if(policy===undefined) return failure(m,'parameter is not allowlisted')
      if (!Number.isInteger(m.value)||m.value<policy.minimum||m.value>policy.maximum) return failure(m,'parameter value is outside allowlisted bounds')
      if (cache.has(m.requestId)) return failure(m,'duplicate requestId')
      const targetKey=key(m.sysId,m.compId,m.name); if(pendingKeys.has(targetKey)) return failure(m,'same parameter write already pending for target')
      if(!canSend(m.sysId,m.compId)) return failure(m,'no live UDP endpoint for requested system')
      const buffer=encodeParameterSet({sysId:gcsSysId,compId:gcsCompId,targetSystemId:m.sysId,targetComponentId:m.compId,name:m.name,value:m.value,paramType:policy.paramType})
      const frame={...failure(m,null),status:'pending',reason:null,attempts:1,updatedAtMs:now()}
      if(send(m.sysId,m.compId,buffer)===false)return emit({...frame,status:'failed',reason:'route disappeared before transmit'})
      pending.set(m.requestId,{frame,buffer,key:targetKey});pendingKeys.set(targetKey,m.requestId);return emit(frame)
    },
    ingestEnvelope(e) {
      if(e?.messageName!=='PARAM_VALUE')return null
      const value=e.payload?.paramValue;const requestId=pendingKeys.get(key(e.sysId,e.compId,value?.paramId));if(requestId===undefined)return null
      const item=pending.get(requestId);if(Math.abs(value.value-item.frame.requestedValue)>1e-6)return null
      remove(requestId,item);return emit({...item.frame,status:'complete',observedValue:value.value,paramType:value.paramType,reason:null,updatedAtMs:now()})
    },
    tick(t=now()){const out=[];pending.forEach((item,id)=>{if(t-item.frame.updatedAtMs<timeoutMs)return
      if(item.frame.attempts<=maxRetries&&canSend(item.frame.sysId,item.frame.compId)&&send(item.frame.sysId,item.frame.compId,item.buffer)!==false){item.frame=emit({...item.frame,attempts:item.frame.attempts+1,updatedAtMs:t});out.push(item.frame);return}
      remove(id,item);out.push(emit({...item.frame,status:'failed',reason:'PARAM_VALUE confirmation timeout',updatedAtMs:t}))});return out},
    ingestRecordedEvent(f){if(f?.type!=='parameterWrite')return null;cache.set(f.requestId,f);return f},
    snapshotForNewClient:()=>[...cache.values()],
  }
}
