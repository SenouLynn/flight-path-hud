import assert from 'node:assert/strict'
import test from 'node:test'
import { createGuidedLandRouter } from './guidedLandRouter.js'
import { MAV_CMD_NAV_LAND } from './guidedLandProtocol.js'

function harness(overrides = {}) {
  let now = 1000; const sent = []
  const state = overrides.state ?? { autopilotType:3, vehicleType:2, armed:true, customMode:4 }
  const router = createGuidedLandRouter({ send:(s,c,b)=>{sent.push({s,c,b});return true}, canSend:()=>overrides.route!==false,
    getFlightState:()=>state, enabled:()=>overrides.enabled!==false, isIsolatedSitl:()=>overrides.isolated!==false,
    isLive:()=>overrides.live!==false, now:()=>now, ackTimeoutMs:100, observationTimeoutMs:200 })
  const request = (extra={}) => router.handleClientMessage({ type:'guidedLand', requestId:'l1', sysId:1, compId:1,
    actor:'operator', timestampMs:900, confirmation:true, safetyCase:'isolated-sitl-guided', ...extra })
  return {router,request,sent,advance:n=>{now+=n}}
}
const ack = (result=0) => ({sysId:1,compId:1,messageName:'COMMAND_ACK',payload:{commandAck:{command:MAV_CMD_NAV_LAND,result}}})
const pos = (m) => ({sysId:1,compId:1,messageName:'GLOBAL_POSITION_INT',payload:{globalPositionInt:{relativeAltMm:m*1000}}})

test('requires exact-target ACK and touchdown observation', () => {
  const h=harness(); assert.equal(h.request().status,'awaitingAck'); assert.equal(h.sent.length,1)
  assert.equal(h.router.ingestEnvelope(ack()).status,'awaitingObservation')
  assert.equal(h.router.ingestEnvelope(pos(5)).observed,false)
  assert.equal(h.router.ingestEnvelope(pos(0.5)).status,'complete')
})
test('gates landing to fresh armed Guided ArduCopter SITL', () => {
  for (const options of [{enabled:false},{isolated:false},{live:false},{route:false},
    {state:{autopilotType:3,vehicleType:1,armed:true,customMode:15}},
    {state:{autopilotType:3,vehicleType:2,armed:false,customMode:4}}]) {
    const h=harness(options); assert.equal(h.request().status,'failed'); assert.equal(h.sent.length,0)
  }
})
test('negative ACK, premature disarm, and bounded timeout fail', () => {
  const bad=harness(); bad.request(); assert.equal(bad.router.ingestEnvelope(ack(3)).status,'failed')
  const disarmed=harness(); disarmed.request(); assert.match(disarmed.router.ingestEnvelope({sysId:1,compId:1,messageName:'HEARTBEAT',payload:{heartbeat:{armed:false}}}).reason,/disarmed/)
  const timed=harness(); timed.request(); timed.router.ingestEnvelope(ack()); timed.advance(201); assert.match(timed.router.tick()[0].reason,/touchdown/)
})
