import assert from 'node:assert/strict'
import test from 'node:test'
import { createParameterListRouter } from './parameterListRouter.js'

function setup() {
  let time = 0
  const sent = [], recorded = []
  const router = createParameterListRouter({
    send: (sysId, compId, buffer) => { sent.push({ sysId, compId, buffer }); return true },
    canSend: () => true, recordEvent: (event) => recorded.push(event), now: () => time,
    idleTimeoutMs: 100, maxRetries: 1,
  })
  return { router, sent, recorded, advance: (ms) => { time += ms } }
}

const value = (sysId, index, count = 3) => ({ sysId, compId: 1, messageName: 'PARAM_VALUE', payload: {
  paramValue: { paramId: `P${index}`, paramIndex: index, paramCount: count, paramType: 9, value: index },
} })

test('folds out-of-order values, ignores duplicates, and completes in index order', () => {
  const { router, sent, recorded } = setup()
  assert.equal(router.handleClientMessage({ type: 'requestParameterList', requestId: 'list-1', sysId: 2, compId: 1 }).status, 'pending')
  assert.equal(`${sent[0].sysId}:${sent[0].compId}`, '2:1')
  assert.equal(router.ingestEnvelope(value(1, 0)), null, 'another target cannot contribute')
  assert.equal(router.ingestEnvelope(value(2, 2)).receivedCount, 1)
  assert.equal(router.ingestEnvelope(value(2, 2)).receivedCount, 1)
  router.ingestEnvelope(value(2, 0))
  const complete = router.ingestEnvelope(value(2, 1))
  assert.equal(complete.status, 'complete')
  assert.deepEqual(complete.parameters.map((item) => item.paramIndex), [0, 1, 2])
  assert.deepEqual(recorded.map((item) => item.status), ['pending', 'complete'])
})

test('rejects concurrent same-target lists and retries after idle progress', () => {
  const { router, sent, advance } = setup()
  router.handleClientMessage({ type: 'requestParameterList', requestId: 'a', sysId: 1, compId: 1 })
  assert.match(router.handleClientMessage({ type: 'requestParameterList', requestId: 'b', sysId: 1, compId: 1 }).reason, /already pending/)
  advance(101)
  assert.equal(router.tick()[0].attempts, 2)
  advance(101)
  assert.equal(router.tick()[0].status, 'failed')
  assert.equal(sent.length, 2)
})

test('replay and invalid targets never send', () => {
  const sent = []
  const router = createParameterListRouter({ send: (...args) => sent.push(args), canSend: () => true, isLive: () => false })
  assert.match(router.handleClientMessage({ type: 'requestParameterList', requestId: 'x', sysId: 1, compId: 1 }).reason, /replay/)
  assert.equal(sent.length, 0)
})
