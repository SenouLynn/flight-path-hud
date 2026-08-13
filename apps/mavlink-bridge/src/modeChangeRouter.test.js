import assert from 'node:assert/strict'
import test from 'node:test'
import { createModeChangeRouter } from './modeChangeRouter.js'
import { MAV_CMD_DO_SET_MODE } from './modeChangeProtocol.js'

function harness({ enabled = true, allowGuided = false, live = true, route = true, state = {} } = {}) {
  let nowMs = 1000
  const sent = [], recorded = []
  let flightState = { armed: false, customMode: 0, vehicleType: 2, ...state }
  const router = createModeChangeRouter({ enabled: () => enabled, allowGuided: () => allowGuided, isLive: () => live,
    canSend: () => route, getFlightState: () => flightState,
    send: (sysId, compId, buffer) => { sent.push({ sysId, compId, buffer }); return true },
    recordEvent: (frame) => recorded.push(frame), now: () => nowMs,
    ackTimeoutMs: 100, observationTimeoutMs: 200, maxRetries: 1 })
  const request = (overrides = {}) => router.handleClientMessage({ type: 'setMode', requestId: 'mode-1',
    sysId: 1, compId: 1, mode: 'LOITER', actor: 'sitl-mode-controller', timestampMs: 900,
    confirmation: true, ...overrides })
  return { router, request, sent, recorded, setState: (next) => { flightState = next },
    advance: (ms) => { nowMs += ms } }
}
const ack = (sysId = 1, result = 0) => ({ sysId, compId: 1, messageName: 'COMMAND_ACK',
  payload: { commandAck: { command: MAV_CMD_DO_SET_MODE, result } } })
const heartbeat = (sysId = 1, customMode = 5, armed = false) => ({ sysId, compId: 1,
  messageName: 'HEARTBEAT', payload: { heartbeat: { customMode, armed } } })

test('Copter mode change requires exact-target ACK and observed HEARTBEAT in either order', () => {
  const first = harness(); assert.equal(first.request().status, 'awaitingAck')
  assert.deepEqual(first.sent.map(({ sysId, compId }) => `${sysId}:${compId}`), ['1:1'])
  assert.equal(first.router.ingestEnvelope(ack(2)), null)
  assert.equal(first.router.ingestEnvelope(heartbeat(1, 5)).status, 'awaitingAck')
  assert.equal(first.router.ingestEnvelope(ack()).status, 'complete')

  const second = harness(); second.request()
  assert.equal(second.router.ingestEnvelope(ack()).status, 'awaitingObservation')
  assert.equal(second.router.ingestEnvelope(heartbeat()).status, 'complete')
})

test('vehicle type selects distinct Copter and Plane mode allowlists', () => {
  const copter = harness(); const copterFrame = copter.request({ mode: 'STABILIZE' })
  assert.match(copterFrame.reason, /already/)
  assert.match(copter.request({ requestId: 'x', mode: 'MANUAL' }).reason, /allowlisted/)

  const plane = harness({ state: { vehicleType: 1 } })
  const frame = plane.request()
  assert.equal(frame.customMode, 12)
  assert.equal(frame.status, 'awaitingAck')
  assert.match(harness({ state: { vehicleType: 1 } }).request({ mode: 'STABILIZE' }).reason, /allowlisted/)
})

test('GUIDED staging has a separate isolated-SITL policy gate', () => {
  assert.match(harness().request({ mode: 'GUIDED' }).reason, /isolated SITL/)
  const copter = harness({ allowGuided: true }).request({ mode: 'GUIDED' })
  assert.equal(copter.customMode, 4); assert.equal(copter.status, 'awaitingAck')
  const plane = harness({ allowGuided: true, state: { vehicleType: 1 } }).request({ mode: 'GUIDED' })
  assert.equal(plane.customMode, 15); assert.equal(plane.status, 'awaitingAck')
})

test('policy rejects unsafe requests without sending', () => {
  const cases = [
    [{ enabled: false }, {}, /disabled/], [{ live: false }, {}, /replay/],
    [{ route: false }, {}, /endpoint/], [{ state: null }, {}, /HEARTBEAT/],
    [{ state: { armed: true } }, {}, /disarmed/], [{}, { confirmation: false }, /confirmation/],
    [{}, { sysId: 0 }, /invalid/], [{ state: { vehicleType: 99 } }, {}, /allowlisted/],
  ]
  for (const [options, overrides, reason] of cases) {
    const configured = options.state === null ? { ...options, state: undefined } : options
    const h = harness(configured)
    if (options.state === null) h.setState(null)
    const frame = h.request(overrides)
    assert.equal(frame.status, 'failed'); assert.match(frame.reason, reason); assert.equal(h.sent.length, 0)
  }
})

test('negative ACK, arming during transition, retries, and observation timeout fail closed', () => {
  const rejected = harness(); rejected.request(); assert.equal(rejected.router.ingestEnvelope(ack(1, 3)).status, 'failed')
  const armed = harness(); armed.request(); assert.match(armed.router.ingestEnvelope(heartbeat(1, 0, true)).reason, /armed/)

  const retry = harness(); retry.request(); retry.advance(101); retry.router.tick()
  assert.equal(retry.sent.length, 2); assert.deepEqual(retry.sent[0].buffer, retry.sent[1].buffer)
  retry.advance(101); assert.match(retry.router.tick()[0].reason, /ACK timeout/)

  const observed = harness(); observed.request(); observed.router.ingestEnvelope(ack()); observed.advance(201)
  assert.match(observed.router.tick()[0].reason, /observation timeout/)
})

test('duplicates, concurrent target requests, and passive replay are safe', () => {
  const h = harness(); h.request()
  assert.match(h.request().reason, /duplicate/)
  assert.match(h.request({ requestId: 'mode-2' }).reason, /already pending/)
  const replay = harness({ live: false, route: false })
  const frame = { type: 'modeChange', requestId: 'recorded', sysId: 1, compId: 1, status: 'complete' }
  assert.equal(replay.router.ingestRecordedEvent(frame), frame)
  assert.deepEqual(replay.router.snapshotForNewClient(), [frame])
  assert.equal(replay.sent.length, 0)
})
