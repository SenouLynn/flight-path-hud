import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { encodeParameterRequestList, encodeParameterRequestRead } from './parameterProtocol.js'
import { createParameterListRouter } from './parameterListRouter.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'contracts/mavlink/parameter-command-vectors.json'), 'utf8'))
const listTrace = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'contracts/semantics/parameter-list-trace.json'), 'utf8'))

test('Node parameter encoders consume the independent payload vectors', () => {
  for (const vector of fixture.vectors) {
    const base = {
      sysId: fixture.source.sysId,
      compId: fixture.source.compId,
      targetSystemId: vector.target.sysId,
      targetComponentId: vector.target.compId,
    }
    const frame = vector.selector.list
      ? encodeParameterRequestList(base)
      : encodeParameterRequestRead({ ...base, name: vector.selector.name ?? null, index: vector.selector.index ?? -1 })
    assert.equal(frame[5], vector.messageId, vector.caseId)
    assert.equal(frame.subarray(6, 6 + frame[1]).toString('hex'), vector.payloadHex, vector.caseId)
  }
})

function valueEnvelope(step) {
  return {
    sysId: step.sysId, compId: step.compId, messageName: 'PARAM_VALUE',
    payload: { paramValue: {
      value: step.value ?? step.index, paramCount: step.count, paramIndex: step.index,
      paramId: `P${step.index}`, paramType: 9,
    } },
  }
}

test('Node list router consumes the ordered parameter-list semantic trace', () => {
  let nowMs = 0
  const sent = []
  const recorded = []
  const router = createParameterListRouter({
    now: () => nowMs,
    canSend: () => true,
    send: (sysId, compId, bytes) => { sent.push({ sysId, compId, bytes: Buffer.from(bytes) }); return true },
    recordEvent: (event) => recorded.push(event),
    idleTimeoutMs: listTrace.defaults.idleTimeoutMs,
    maxRetries: listTrace.defaults.maxRetries,
  })
  const request = listTrace.orderingScenario.request
  for (const step of listTrace.orderingScenario.steps) {
    nowMs = step.atMs
    const output = step.kind === 'start'
      ? router.handleClientMessage({ type: 'requestParameterList', ...request })
      : router.ingestEnvelope(valueEnvelope(step))
    if (step.wantOutput === false) {
      assert.equal(output, null, step.caseId)
      continue
    }
    if (step.wantStatus !== undefined) assert.equal(output.status, step.wantStatus, step.caseId)
    if (step.wantReceivedCount !== undefined) assert.equal(output.receivedCount, step.wantReceivedCount, step.caseId)
    if (step.wantIndexes !== undefined) assert.deepEqual(output.parameters.map(({ paramIndex }) => paramIndex), step.wantIndexes, step.caseId)
  }
  assert.deepEqual(recorded.map(({ status }) => status), ['pending', 'complete'])
  assert.equal(sent.length, 1)
})

test('Node list router consumes fixed idle thresholds from the semantic trace', () => {
  let nowMs = 0
  let route = true
  const sent = []
  const router = createParameterListRouter({
    now: () => nowMs, canSend: () => route,
    send: (_sysId, _compId, bytes) => { sent.push(Buffer.from(bytes)); return true },
    idleTimeoutMs: listTrace.defaults.idleTimeoutMs,
    maxRetries: listTrace.defaults.maxRetries,
  })
  router.handleClientMessage({ type: 'requestParameterList', ...listTrace.idleScenario.request })
  for (const step of listTrace.idleScenario.steps) {
    nowMs = step.atMs
    const output = router.tick()
    if (step.wantOutputs !== undefined) assert.equal(output.length, step.wantOutputs, step.caseId)
    if (step.wantAttempts !== undefined) assert.equal(output[0].attempts, step.wantAttempts, step.caseId)
    if (step.wantStatus !== undefined) assert.equal(output[0].status, step.wantStatus, step.caseId)
    if (step.wantReason !== undefined) assert.equal(output[0].reason, step.wantReason, step.caseId)
  }
  assert.equal(sent.length, 3)
})

test('Node list router consumes route-loss, replay, and invalid-target trace cases', () => {
  const cases = Object.fromEntries(listTrace.independentCases.map((item) => [item.caseId, item]))
  let route = true
  let nowMs = 0
  const sent = []
  const router = createParameterListRouter({
    now: () => nowMs, canSend: () => route,
    send: (...args) => { sent.push(args); return true },
    idleTimeoutMs: listTrace.defaults.idleTimeoutMs,
  })
  router.handleClientMessage({ type: 'requestParameterList', requestId: 'route-loss', sysId: 1, compId: 1 })
  route = false
  nowMs = listTrace.defaults.idleTimeoutMs
  const routeLoss = router.tick()[0]
  assert.equal(routeLoss.reason, cases['PARAM-ROUTE-LOSS'].wantReason)
  assert.equal(sent.length - 1, cases['PARAM-ROUTE-LOSS'].wantAdditionalSends)

  const replaySent = []
  const replay = createParameterListRouter({ isLive: () => false, canSend: () => true, send: (...args) => replaySent.push(args) })
  assert.equal(replay.handleClientMessage({ type: 'requestParameterList', requestId: 'replay', sysId: 1, compId: 1 }).status, cases['PARAM-REPLAY'].wantStatus)
  assert.equal(replaySent.length, cases['PARAM-REPLAY'].wantSends)

  const invalidSent = []
  const invalid = createParameterListRouter({ canSend: () => true, send: (...args) => invalidSent.push(args) })
  assert.equal(invalid.handleClientMessage({ type: 'requestParameterList', requestId: 'invalid', sysId: 0, compId: 1 }).status, cases['PARAM-INVALID-TARGET'].wantStatus)
  assert.equal(invalidSent.length, cases['PARAM-INVALID-TARGET'].wantSends)
})
