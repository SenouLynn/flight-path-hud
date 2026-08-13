import assert from 'node:assert/strict'
import test from 'node:test'
import { createMissionUploadRouter } from './missionUploadRouter.js'

const items = [
  { command: 16, frameId: 3, current: true, autocontinue: true, latDegE7: 473977420, lonDegE7: 85455940, altM: 50 },
  { command: 16, frameId: 3, current: false, autocontinue: true, latDegE7: 473978000, lonDegE7: 85456000, altM: 70 },
]
const envelope = (messageName, payload, sysId = 2) => ({ sysId, compId: 1, messageName, payload })
const ack = (sysId = 2, type = 0) => envelope('MISSION_ACK', { missionAck: { type } }, sysId)
const request = (seq, sysId = 2) => envelope('MISSION_REQUEST_INT', {
  missionRequestInt: { seq, targetSystem: 255, targetComponent: 190 },
}, sysId)

function harness({ enabled = true, live = true, route = true } = {}) {
  let nowMs = 1000
  const sent = [], recorded = []
  const router = createMissionUploadRouter({ enabled: () => enabled, isLive: () => live,
    canSend: () => route, send: (sysId, compId, buffer) => { sent.push({ sysId, compId, buffer }); return true },
    recordEvent: (frame) => recorded.push(frame), now: () => nowMs, timeoutMs: 100, maxRetries: 1 })
  const start = (overrides = {}) => router.handleClientMessage({ type: 'uploadMission', requestId: 'upload-1',
    sysId: 2, compId: 1, actor: 'sitl-test', timestampMs: 900, confirmation: true,
    policy: 'clearThenReplace', items, ...overrides })
  return { router, start, sent, recorded, advance: (ms) => { nowMs += ms } }
}

test('routes replacement and automatic read-back only to the exact target', () => {
  const { router, start, sent, recorded } = harness()
  assert.equal(start().status, 'clearing')
  assert.deepEqual(sent.map((entry) => `${entry.sysId}:${entry.compId}`), ['2:1'])
  assert.equal(router.ingestEnvelope(ack(1)), null)
  router.ingestEnvelope(ack())
  router.ingestEnvelope(request(0)); router.ingestEnvelope(request(1))
  const reading = router.ingestEnvelope(ack())
  assert.equal(reading.status, 'awaitingReadback')
  assert.equal(sent.at(-1).buffer[5], 43, 'read-back starts with MISSION_REQUEST_LIST')

  router.ingestEnvelope(envelope('MISSION_COUNT', { missionCount: { count: 2 } }))
  router.ingestEnvelope(envelope('MISSION_ITEM_INT', { missionItemInt: { ...items[0], seq: 0, param1: 0, param2: 0, param3: 0, param4: 0 } }))
  const complete = router.ingestEnvelope(envelope('MISSION_ITEM_INT', { missionItemInt: { ...items[1], seq: 1, param1: 0, param2: 0, param3: 0, param4: 0 } }))
  assert.equal(complete.status, 'complete')
  assert.equal(complete.itemCount, 2)
  assert.ok(sent.every(({ sysId, compId }) => sysId === 2 && compId === 1))
  assert.deepEqual(recorded.map(({ status } ) => status), ['clearing', 'uploading', 'uploading', 'uploading', 'awaitingReadback', 'awaitingReadback', 'awaitingReadback', 'complete'])
  assert.deepEqual(router.snapshotForNewClient(), [complete])
})

test('policy rejects disabled, replay, stale, unconfirmed, unsafe, duplicate and concurrent uploads', () => {
  const cases = [
    [{ enabled: false }, {}, /disabled/], [{ live: false }, {}, /replay/],
    [{ route: false }, {}, /endpoint/], [{}, { confirmation: false }, /confirmation/],
    [{}, { policy: 'append' }, /clearThenReplace/], [{}, { sysId: 0 }, /non-broadcast/],
    [{}, { items: [] }, /1..65535/],
  ]
  for (const [options, overrides, reason] of cases) {
    const { start, sent } = harness(options); const frame = start(overrides)
    assert.equal(frame.status, 'rejected'); assert.match(frame.reason, reason); assert.equal(sent.length, 0)
  }

  const duplicate = harness(); duplicate.start()
  assert.match(duplicate.start().reason, /duplicate/)
  const concurrent = duplicate.start({ requestId: 'upload-2' })
  assert.match(concurrent.reason, /already pending/)
})

test('negative ACK, read-back mismatch, retry exhaustion, and stale route fail closed', () => {
  const rejected = harness(); rejected.start(); const negative = rejected.router.ingestEnvelope(ack(2, 3))
  assert.equal(negative.status, 'failed')

  const mismatch = harness(); mismatch.start(); mismatch.router.ingestEnvelope(ack())
  mismatch.router.ingestEnvelope(request(0)); mismatch.router.ingestEnvelope(request(1)); mismatch.router.ingestEnvelope(ack())
  mismatch.router.ingestEnvelope(envelope('MISSION_COUNT', { missionCount: { count: 1 } }))
  const failed = mismatch.router.ingestEnvelope(envelope('MISSION_ITEM_INT', { missionItemInt: { ...items[0], seq: 0, param1: 0, param2: 0, param3: 0, param4: 0 } }))
  assert.match(failed.reason, /read-back did not match/)

  const timed = harness(); timed.start(); timed.advance(101); timed.router.tick(); timed.advance(101)
  assert.equal(timed.router.tick()[0].status, 'failed')

  let route = true
  const stale = createMissionUploadRouter({ enabled: () => true, isLive: () => true, canSend: () => route,
    send: () => true, now: () => 1 })
  stale.handleClientMessage({ type: 'uploadMission', requestId: 'x', sysId: 2, compId: 1,
    actor: 'a', timestampMs: 1, confirmation: true, policy: 'clearThenReplace', items })
  route = false
  assert.match(stale.tick()[0].reason, /stale/)
})

test('recorded lifecycle folds passively without sending', () => {
  const { router, sent } = harness({ live: false, route: false })
  const frame = { type: 'missionUpload', requestId: 'recorded', sysId: 2, compId: 1,
    status: 'complete', itemCount: 2, requestedCount: 2 }
  assert.equal(router.ingestRecordedEvent(frame), frame)
  assert.deepEqual(router.snapshotForNewClient(), [frame])
  assert.equal(sent.length, 0)
})
