import assert from 'node:assert/strict'
import test from 'node:test'
import { createArmDisarmRouter } from './armDisarmRouter.js'
import { MAV_CMD_COMPONENT_ARM_DISARM } from './armDisarmProtocol.js'

function harness({ enabled = true, isolated = true, live = true, route = true,
  state = {}, maxRetries = 0 } = {}) {
  let nowMs = 1000
  const sent = [], recorded = []
  let flightState = { armed: false, autopilotType: 3, vehicleType: 2, ...state }
  const router = createArmDisarmRouter({ enabled: () => enabled, isIsolatedSitl: () => isolated,
    isLive: () => live, canSend: () => route, getFlightState: () => flightState,
    send: (sysId, compId, buffer) => { sent.push({ sysId, compId, buffer }); return true },
    recordEvent: (frame) => recorded.push(frame), now: () => nowMs,
    ackTimeoutMs: 100, observationTimeoutMs: 200, maxRetries })
  const request = (overrides = {}) => router.handleClientMessage({ type: 'setArmed', requestId: 'arm-1',
    sysId: 1, compId: 1, arm: true, actor: 'sitl-arm-controller', timestampMs: 900,
    confirmation: true, safetyCase: 'sitl-no-propulsion', ...overrides })
  return { router, request, sent, recorded, setState: (next) => { flightState = next },
    advance: (ms) => { nowMs += ms } }
}
const ack = (sysId = 1, result = 0) => ({ sysId, compId: 1, messageName: 'COMMAND_ACK',
  payload: { commandAck: { command: MAV_CMD_COMPONENT_ARM_DISARM, result } } })
const heartbeat = (sysId = 1, armed = true) => ({ sysId, compId: 1, messageName: 'HEARTBEAT',
  payload: { heartbeat: { armed } } })

test('completes only after exact-target ACK and armed HEARTBEAT in either order', () => {
  const first = harness(); assert.equal(first.request().status, 'awaitingAck')
  assert.deepEqual(first.sent.map(({ sysId, compId }) => `${sysId}:${compId}`), ['1:1'])
  assert.equal(first.router.ingestEnvelope(ack(2)), null)
  assert.equal(first.router.ingestEnvelope(heartbeat()).status, 'awaitingAck')
  assert.equal(first.router.ingestEnvelope(ack()).status, 'complete')

  const second = harness(); second.request()
  assert.equal(second.router.ingestEnvelope(ack()).status, 'awaitingObservation')
  assert.equal(second.router.ingestEnvelope(heartbeat()).status, 'complete')
})

test('disarm uses the same verified transaction from observed armed state', () => {
  const h = harness({ state: { armed: true } })
  assert.equal(h.request({ arm: false }).status, 'awaitingAck')
  h.router.ingestEnvelope(ack())
  const complete = h.router.ingestEnvelope(heartbeat(1, false))
  assert.equal(complete.status, 'complete'); assert.equal(complete.arm, false)
})

test('dual gates and safety preconditions reject without sending', () => {
  const cases = [
    [{ enabled: false }, {}, /disabled/], [{ isolated: false }, {}, /isolated SITL/],
    [{ live: false }, {}, /replay/], [{ route: false }, {}, /endpoint/],
    [{}, { confirmation: false }, /confirmation/], [{}, { safetyCase: 'props-on' }, /safety case/],
    [{}, { arm: 1 }, /invalid/], [{ state: { autopilotType: 0 } }, {}, /not allowlisted/],
    [{ state: { vehicleType: 10 } }, {}, /not allowlisted/], [{ state: { armed: true } }, {}, /already armed/],
  ]
  for (const [options, overrides, reason] of cases) {
    const h = harness(options); const frame = h.request(overrides)
    assert.equal(frame.status, 'failed'); assert.match(frame.reason, reason); assert.equal(h.sent.length, 0)
  }
  const missing = harness(); missing.setState(null)
  assert.match(missing.request().reason, /HEARTBEAT/); assert.equal(missing.sent.length, 0)
})

test('negative ACK, default no-retry timeout, observation timeout, and stale route fail closed', () => {
  const negative = harness(); negative.request(); assert.equal(negative.router.ingestEnvelope(ack(1, 3)).status, 'failed')
  const timed = harness(); timed.request(); timed.advance(101)
  assert.match(timed.router.tick()[0].reason, /ACK timeout/); assert.equal(timed.sent.length, 1)
  const observed = harness(); observed.request(); observed.router.ingestEnvelope(ack()); observed.advance(201)
  assert.match(observed.router.tick()[0].reason, /observation timeout/)
  const stale = harness({ route: false }); assert.match(stale.request().reason, /endpoint/)
})

test('an injected retry budget is bounded and retransmits identical bytes', () => {
  const h = harness({ maxRetries: 1 }); h.request(); h.advance(101); h.router.tick()
  assert.equal(h.sent.length, 2); assert.deepEqual(h.sent[0].buffer, h.sent[1].buffer)
  h.advance(101); assert.equal(h.router.tick()[0].status, 'failed')
})

test('duplicates, same-target concurrency, and passive replay are safe', () => {
  const h = harness(); h.request()
  assert.match(h.request().reason, /duplicate/)
  assert.match(h.request({ requestId: 'arm-2' }).reason, /already pending/)
  const replay = harness({ live: false, route: false })
  const frame = { type: 'armDisarm', requestId: 'recorded', sysId: 1, compId: 1, status: 'complete' }
  assert.equal(replay.router.ingestRecordedEvent(frame), frame)
  assert.deepEqual(replay.router.snapshotForNewClient(), [frame]); assert.equal(replay.sent.length, 0)
})
