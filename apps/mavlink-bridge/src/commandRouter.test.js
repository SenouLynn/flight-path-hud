import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommandRouter } from './commandRouter.js'

function harness({ live = true, route = true, sendResult = true } = {}) {
  let nowMs = 1000
  const sent = []
  const recorded = []
  const definitions = new Map([['test.ping', {
    command: 31000,
    encode: ({ params }) => {
      if (params.bad) throw new Error('bad params')
      return Buffer.from([1, 2, 3])
    },
  }]])
  const router = createCommandRouter({
    definitions,
    send: (sysId, compId, buffer) => {
      sent.push({ sysId, compId, buffer })
      return sendResult
    },
    canSend: () => route,
    isLive: () => live,
    recordEvent: (event) => recorded.push(event),
    now: () => nowMs,
    timeoutMs: 500,
    maxRetries: 1,
  })
  const request = (overrides = {}) => router.handleClientMessage({
    type: 'commandRequest', requestId: 'req-1', sysId: 1, compId: 1,
    family: 'test.ping', actor: 'sitl-test', timestampMs: 900,
    confirmation: true, params: {}, ...overrides,
  })
  return { router, request, sent, recorded, advance: (ms) => { nowMs += ms } }
}

test('an allowlisted confirmed command is routed to its exact target and recorded', () => {
  const { request, sent, recorded } = harness()
  const frame = request({ sysId: 2, compId: 7 })
  assert.equal(frame.status, 'transmitted')
  assert.deepEqual(sent.map(({ sysId, compId }) => `${sysId}:${compId}`), ['2:7'])
  assert.deepEqual(recorded.map(({ status }) => status), ['requested', 'transmitted'])
  assert.equal(frame.actor, 'sitl-test')
  assert.equal(frame.confirmation, true)
})

test('COMMAND_ACK is correlated by target and command', () => {
  const { router, request, recorded } = harness()
  request()
  assert.equal(router.ingestEnvelope({
    sysId: 2, compId: 1, messageName: 'COMMAND_ACK',
    payload: { commandAck: { command: 31000, result: 0 } },
  }), null, 'another system cannot complete the request')
  const frame = router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'COMMAND_ACK',
    payload: { commandAck: { command: 31000, result: 0 } },
  })
  assert.equal(frame.requestId, 'req-1')
  assert.equal(frame.status, 'acknowledged')
  assert.deepEqual(recorded.map(({ status }) => status), ['requested', 'transmitted', 'acknowledged'])
})

test('negative ACK and timeout/retry produce normalized statuses', () => {
  const failed = harness()
  failed.request()
  assert.equal(failed.router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'COMMAND_ACK',
    payload: { commandAck: { command: 31000, result: 3 } },
  }).status, 'failed')

  const timed = harness()
  timed.request()
  timed.advance(501)
  assert.equal(timed.router.tick()[0].status, 'retrying')
  assert.equal(timed.sent.length, 2)
  timed.advance(501)
  assert.equal(timed.router.tick()[0].status, 'timedOut')
  assert.deepEqual(timed.router.tick(), [], 'timeout is emitted once')
})

test('policy rejects unsafe input without sending any packet', () => {
  const cases = [
    [{ confirmation: false }, /confirmation/],
    [{ family: 'raw.mavlink' }, /allowlisted/],
    [{ sysId: 0 }, /non-broadcast/],
    [{ requestId: '' }, /requestId/],
    [{ actor: '' }, /actor/],
    [{ timestampMs: null }, /timestamp/],
  ]
  cases.forEach(([overrides, reason]) => {
    const { request, sent } = harness()
    const frame = request(overrides)
    assert.equal(frame.status, 'rejected')
    assert.match(frame.reason, reason)
    assert.equal(sent.length, 0)
  })
})

test('replay and stale routes reject commands without emitting bytes', () => {
  for (const options of [{ live: false }, { route: false }]) {
    const { request, sent } = harness(options)
    assert.equal(request().status, 'rejected')
    assert.equal(sent.length, 0)
  }
})

test('a route disappearing between validation and send fails instead of claiming transmission', () => {
  const { request, recorded } = harness({ sendResult: false })
  const frame = request()
  assert.equal(frame.status, 'failed')
  assert.match(frame.reason, /disappeared/)
  assert.deepEqual(recorded.map(({ status }) => status), ['requested', 'failed'])
})

test('duplicate request IDs and ambiguous concurrent target commands are rejected', () => {
  const first = harness()
  assert.equal(first.request().status, 'transmitted')
  assert.match(first.request().reason, /duplicate/)
  assert.equal(first.sent.length, 1)

  const second = harness()
  second.request()
  const collision = second.request({ requestId: 'req-2' })
  assert.match(collision.reason, /already pending/)
  assert.equal(second.sent.length, 1)
})

test('recorded statuses replay passively and are cached for late clients', () => {
  const { router, sent } = harness({ live: false })
  const event = { type: 'commandStatus', requestId: 'old-1', sysId: 1, compId: 1, status: 'acknowledged' }
  assert.deepEqual(router.ingestRecordedEvent(event), event)
  assert.deepEqual(router.snapshotForNewClient(), [event])
  assert.equal(sent.length, 0)
})
