import assert from 'node:assert/strict'
import test from 'node:test'
import { createParameterRouter } from './parameterRouter.js'
import { decodeParameterRequestRead } from './parameterProtocol.js'

function harness({ live = true, route = true } = {}) {
  let nowMs = 1000
  let routeValue = route
  const sent = []
  const recorded = []
  const router = createParameterRouter({
    send: (sysId, compId, buffer) => { sent.push({ sysId, compId, buffer }); return true },
    canSend: () => routeValue, isLive: () => live,
    recordEvent: (event) => recorded.push(event), now: () => nowMs,
    timeoutMs: 100, maxRetries: 1,
  })
  const request = (overrides = {}) => router.handleClientMessage({
    type: 'requestParameter', requestId: 'param-1', sysId: 1, compId: 1,
    name: 'SYSID_THISMAV', ...overrides,
  })
  return { router, request, sent, recorded,
    advance: (ms) => { nowMs += ms }, setRoute: (value) => { routeValue = value } }
}

function valueEnvelope(overrides = {}) {
  return {
    sysId: 1, compId: 1, messageName: 'PARAM_VALUE',
    payload: { paramValue: {
      paramId: 'SYSID_THISMAV', paramIndex: 4, paramCount: 1200, paramType: 6, value: 1,
      ...overrides,
    } },
  }
}

test('name read routes only to the requested system and completes on its matching value', () => {
  const { router, request, sent, recorded } = harness()
  const pending = request({ sysId: 2, compId: 1, name: 'ARSPD_FBW_MIN' })
  assert.equal(pending.status, 'pending')
  assert.equal(`${sent[0].sysId}:${sent[0].compId}`, '2:1')
  assert.deepEqual(decodeParameterRequestRead(sent[0].buffer), {
    targetSystem: 2, targetComponent: 1, index: -1, name: 'ARSPD_FBW_MIN',
  })
  const complete = router.ingestEnvelope(valueEnvelope({ paramId: 'ARSPD_FBW_MIN', value: 12, paramIndex: 70 }))
  assert.equal(complete, null, 'Copter response cannot complete Plane request')
  const plane = router.ingestEnvelope({ ...valueEnvelope({ paramId: 'ARSPD_FBW_MIN', value: 12, paramIndex: 70 }), sysId: 2 })
  assert.equal(plane.status, 'complete')
  assert.equal(plane.value.value, 12)
  assert.deepEqual(recorded.map(({ status }) => status), ['pending', 'complete'])
})

test('index read correlates by index rather than incidental parameter name', () => {
  const { router, request, sent } = harness()
  request({ name: undefined, index: 9 })
  assert.equal(decodeParameterRequestRead(sent[0].buffer).index, 9)
  assert.equal(router.ingestEnvelope(valueEnvelope({ paramIndex: 8 })), null)
  assert.equal(router.ingestEnvelope(valueEnvelope({ paramId: 'WHATEVER', paramIndex: 9 })).status, 'complete')
})

test('timeout retries the same bytes, then fails once', () => {
  const { router, request, sent, advance } = harness()
  request()
  advance(101)
  assert.equal(router.tick()[0].attempts, 2)
  assert.ok(sent[0].buffer.equals(sent[1].buffer))
  advance(101)
  assert.equal(router.tick()[0].status, 'failed')
  assert.deepEqual(router.tick(), [])
})

test('a stale route during a pending read stops retries', () => {
  const { router, request, sent, advance, setRoute } = harness()
  request()
  setRoute(false)
  advance(101)
  const failed = router.tick()[0]
  assert.match(failed.reason, /stale/)
  assert.equal(sent.length, 1)
})

test('replay, missing routes, invalid selectors, broadcast IDs, and duplicates send nothing', () => {
  for (const [options, overrides, reason] of [
    [{ live: false }, {}, /replay/],
    [{ route: false }, {}, /no live UDP/],
    [{}, { name: 'A', index: 1 }, /exactly one/],
    [{}, { name: undefined, index: -1 }, /range/],
    [{}, { sysId: 0 }, /non-broadcast/],
  ]) {
    const { request, sent } = harness(options)
    const frame = request(overrides)
    assert.equal(frame.status, 'failed')
    assert.match(frame.reason, reason)
    assert.equal(sent.length, 0)
  }
  const duplicate = harness()
  duplicate.request()
  assert.match(duplicate.request().reason, /duplicate/)
  assert.match(duplicate.request({ requestId: 'param-2' }).reason, /already pending/)
  assert.equal(duplicate.sent.length, 1)
})

test('recorded parameter state folds passively for replay and late clients', () => {
  const { router, sent } = harness({ live: false })
  const event = { type: 'parameterRead', requestId: 'old', sysId: 2, compId: 1, status: 'complete' }
  assert.deepEqual(router.ingestRecordedEvent(event), event)
  assert.deepEqual(router.snapshotForNewClient(), [event])
  assert.equal(sent.length, 0)
})
