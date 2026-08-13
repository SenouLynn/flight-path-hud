import assert from 'node:assert/strict'
import test from 'node:test'
import { createGuidedTakeoffRouter } from './guidedTakeoffRouter.js'
import { MAV_CMD_NAV_TAKEOFF } from './guidedTakeoffProtocol.js'

function harness(overrides = {}) {
  let now = 1000; const sent = []
  const state = overrides.state ?? { autopilotType: 3, vehicleType: 2, armed: true, customMode: 4 }
  const router = createGuidedTakeoffRouter({ send: (s,c,b) => { sent.push({s,c,b}); return true }, canSend: () => overrides.route !== false,
    getFlightState: () => state, enabled: () => overrides.enabled !== false, isIsolatedSitl: () => overrides.isolated !== false,
    isLive: () => overrides.live !== false, now: () => now, ackTimeoutMs: 100, observationTimeoutMs: 200 })
  const request = (extra = {}) => router.handleClientMessage({ type: 'guidedTakeoff', requestId: 't1', sysId: 1, compId: 1,
    actor: 'operator', timestampMs: 900, confirmation: true, safetyCase: 'isolated-sitl-guided', relativeAltitudeM: 10, altitudeToleranceM: 2, ...extra })
  return { router, request, sent, advance: n => { now += n } }
}
const ack = (result = 0) => ({ sysId: 1, compId: 1, messageName: 'COMMAND_ACK', payload: { commandAck: { command: MAV_CMD_NAV_TAKEOFF, result } } })
const position = (altM) => ({ sysId: 1, compId: 1, messageName: 'GLOBAL_POSITION_INT', payload: { globalPositionInt: { relativeAltMm: altM * 1000 } } })

test('requires ACK and observed relative altitude', () => {
  const h = harness(); assert.equal(h.request().status, 'awaitingAck'); assert.equal(h.sent.length, 1)
  assert.equal(h.router.ingestEnvelope(position(9)).status, 'awaitingAck')
  assert.equal(h.router.ingestEnvelope(ack()).status, 'complete')
})

test('fails closed outside fresh armed Copter Guided SITL', () => {
  for (const options of [{enabled:false}, {isolated:false}, {live:false}, {route:false},
    {state:{autopilotType:3,vehicleType:1,armed:true,customMode:15}}, {state:{autopilotType:3,vehicleType:2,armed:false,customMode:4}},
    {state:{autopilotType:3,vehicleType:2,armed:true,customMode:5}}]) {
    const h = harness(options); assert.equal(h.request().status, 'failed'); assert.equal(h.sent.length, 0)
  }
})

test('negative ACK, state escape, and timeouts fail', () => {
  const rejected = harness(); rejected.request(); assert.equal(rejected.router.ingestEnvelope(ack(3)).status, 'failed')
  const escaped = harness(); escaped.request(); assert.match(escaped.router.ingestEnvelope({ sysId:1, compId:1, messageName:'HEARTBEAT', payload:{heartbeat:{armed:false,customMode:4}} }).reason, /left/)
  const timed = harness(); timed.request(); timed.advance(101); assert.match(timed.router.tick()[0].reason, /ACK timeout/)
})
