import assert from 'node:assert/strict'
import test from 'node:test'
import { createGuidedRepositionRouter } from './guidedRepositionRouter.js'
import { MAV_CMD_DO_REPOSITION } from './guidedRepositionProtocol.js'

const safetyEnvelope = { minLatitudeDeg: 34.99, maxLatitudeDeg: 35.01,
  minLongitudeDeg: -80.01, maxLongitudeDeg: -79.99, minRelativeAltitudeM: 10,
  maxRelativeAltitudeM: 120, maxArrivalRadiusM: 20, maxAltitudeToleranceM: 10 }

function harness({ enabled = true, isolated = true, live = true, route = true,
  state = { autopilotType: 3, vehicleType: 2, armed: true, customMode: 4 }, maxRetries = 0 } = {}) {
  let nowMs = 1000
  let hasRoute = route
  const sent = [], recorded = []
  const router = createGuidedRepositionRouter({ enabled: () => enabled,
    isIsolatedSitl: () => isolated, isLive: () => live, canSend: () => hasRoute,
    getFlightState: () => state, send: (sysId, compId, buffer) => {
      sent.push({ sysId, compId, buffer }); return true
    }, recordEvent: (frame) => recorded.push(frame), now: () => nowMs,
    ackTimeoutMs: 100, observationTimeoutMs: 200, maxRetries })
  const request = (overrides = {}) => router.handleClientMessage({ type: 'guidedReposition',
    requestId: 'guided-1', sysId: 1, compId: 1, latitudeDeg: 35,
    longitudeDeg: -80, relativeAltitudeM: 25, arrivalRadiusM: 5,
    altitudeToleranceM: 2, actor: 'sitl-guided-controller', timestampMs: 900,
    confirmation: true, safetyCase: 'isolated-sitl-guided', safetyEnvelope, ...overrides })
  return { router, request, sent, recorded, advance(ms) { nowMs += ms },
    setRoute(value) { hasRoute = value } }
}

const ack = (sysId = 1, result = 0) => ({ sysId, compId: 1, messageName: 'COMMAND_ACK',
  payload: { commandAck: { command: MAV_CMD_DO_REPOSITION, result } } })
const position = (sysId = 1, latDegE7 = 350000000, relativeAltMm = 25000) => ({
  sysId, compId: 1, messageName: 'GLOBAL_POSITION_INT',
  payload: { globalPositionInt: { latDegE7, lonDegE7: -800000000, relativeAltMm } } })
const heartbeat = (armed = true, customMode = 4) => ({ sysId: 1, compId: 1,
  messageName: 'HEARTBEAT', payload: { heartbeat: { armed, customMode } } })

test('completes only after exact-target ACK and position observation in either order', () => {
  const first = harness()
  assert.equal(first.request().status, 'awaitingAck')
  assert.deepEqual(first.sent.map(({ sysId, compId }) => `${sysId}:${compId}`), ['1:1'])
  assert.equal(first.router.ingestEnvelope(ack(2)), null)
  assert.equal(first.router.ingestEnvelope(position(1, 350010000)), null, 'in-transit position is not terminal')
  assert.equal(first.router.ingestEnvelope(position()).status, 'awaitingAck')
  assert.equal(first.router.ingestEnvelope(ack()).status, 'complete')

  const second = harness(); second.request()
  assert.equal(second.router.ingestEnvelope(ack()).status, 'awaitingObservation')
  const complete = second.router.ingestEnvelope(position())
  assert.equal(complete.status, 'complete'); assert.equal(complete.observed, true)
  assert.equal(complete.horizontalDistanceM, 0); assert.equal(complete.altitudeErrorM, 0)
})

test('dual gates, policy, routes, duplicate IDs, and target concurrency fail closed', () => {
  const cases = [
    [{ enabled: false }, {}, /disabled/], [{ isolated: false }, {}, /isolated SITL/],
    [{ live: false }, {}, /replay/], [{ route: false }, {}, /endpoint/],
    [{ state: null }, {}, /HEARTBEAT/], [{}, { confirmation: false }, /confirmation/],
    [{}, { latitudeDeg: 36 }, /safety envelope/],
  ]
  for (const [options, overrides, reason] of cases) {
    const h = harness(options); const frame = h.request(overrides)
    assert.equal(frame.status, 'failed'); assert.match(frame.reason, reason); assert.equal(h.sent.length, 0)
  }
  const h = harness(); h.request()
  assert.match(h.request().reason, /duplicate/)
  assert.match(h.request({ requestId: 'guided-2' }).reason, /already pending/)
})

test('malformed target identities are normalized in failure frames', () => {
  const frame = harness().request({ sysId: 999, compId: -1 })
  assert.equal(frame.status, 'failed')
  assert.equal(frame.sysId, null)
  assert.equal(frame.compId, null)
})

test('negative ACK, state escape, timeouts, and route loss fail closed with no default retry', () => {
  const rejected = harness(); rejected.request()
  assert.equal(rejected.router.ingestEnvelope(ack(1, 3)).ackResult, 3)
  const disarmed = harness(); disarmed.request()
  assert.match(disarmed.router.ingestEnvelope(heartbeat(false)).reason, /disarmed/)
  const modeEscape = harness(); modeEscape.request()
  assert.match(modeEscape.router.ingestEnvelope(heartbeat(true, 5)).reason, /left Guided/)

  const noRetry = harness(); noRetry.request(); noRetry.advance(101)
  assert.match(noRetry.router.tick()[0].reason, /ACK timeout/); assert.equal(noRetry.sent.length, 1)
  const observation = harness(); observation.request(); observation.router.ingestEnvelope(ack())
  observation.advance(201); assert.match(observation.router.tick()[0].reason, /observation timeout/)
  const stale = harness(); stale.request(); stale.setRoute(false); stale.advance(101)
  assert.match(stale.router.tick()[0].reason, /route became stale/)
})

test('an injected retry budget is bounded, and recorded lifecycle replay is passive', () => {
  const retry = harness({ maxRetries: 1 }); retry.request(); retry.advance(101); retry.router.tick()
  assert.equal(retry.sent.length, 2); assert.deepEqual(retry.sent[0].buffer, retry.sent[1].buffer)
  retry.advance(101); assert.match(retry.router.tick()[0].reason, /ACK timeout/)

  const replay = harness({ live: false, route: false })
  const frame = { type: 'guidedReposition', requestId: 'recorded', sysId: 1,
    compId: 1, status: 'complete' }
  assert.equal(replay.router.ingestRecordedEvent(frame), frame)
  assert.deepEqual(replay.router.snapshotForNewClient(), [frame])
  assert.equal(replay.sent.length, 0)
})
