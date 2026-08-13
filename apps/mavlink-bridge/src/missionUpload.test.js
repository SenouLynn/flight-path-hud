import assert from 'node:assert/strict'
import test from 'node:test'
import { createMissionUpload } from './missionUpload.js'

const items = [
  { command: 16, frameId: 3, current: true, autocontinue: true, latDegE7: 473977420, lonDegE7: 85455940, altM: 50 },
  { command: 16, frameId: 3, current: false, autocontinue: true, latDegE7: 473978000, lonDegE7: 85456000, altM: 70 },
]
const ack = (sysId = 2, type = 0) => ({ sysId, compId: 1, messageName: 'MISSION_ACK', payload: { missionAck: { type } } })
const request = (seq, overrides = {}) => ({ sysId: 2, compId: 1, messageName: 'MISSION_REQUEST_INT',
  payload: { missionRequestInt: { seq, targetSystem: 255, targetComponent: 190, ...overrides } } })
const legacyRequest = (seq) => ({ sysId: 2, compId: 1, messageName: 'MISSION_REQUEST',
  payload: { missionRequest: { seq, targetSystem: 255, targetComponent: 190 } } })

function harness(options = {}) {
  let nowMs = 1000
  const sent = []
  const upload = createMissionUpload({ targetSystemId: 2, targetComponentId: 1,
    send: (buffer) => { sent.push(buffer); return options.sendResult ?? true }, now: () => nowMs,
    timeoutMs: 100, maxRetries: 1 })
  return { upload, sent, advance: (ms) => { nowMs += ms } }
}

test('replace uploads requested items then completes only after matching read-back', () => {
  const { upload, sent } = harness()
  assert.equal(upload.start(items).status, 'clearing')
  assert.equal(sent[0][5], 45)
  upload.ingestEnvelope(ack())
  assert.equal(upload.getState().status, 'uploading')
  assert.equal(sent[1][5], 44)
  upload.ingestEnvelope(request(1))
  upload.ingestEnvelope(request(0))
  assert.equal(upload.getState().requestedCount, 2)
  upload.ingestEnvelope(ack())
  assert.equal(upload.getState().status, 'awaitingReadback')
  assert.equal(upload.confirmReadback(items.map((item, seq) => ({ ...item, seq, param1: 0, param2: 0, param3: 0, param4: 0 }))), true)
  assert.equal(upload.getState().status, 'complete')
  assert.deepEqual(sent.map((frame) => frame[5]), [45, 44, 73, 73])
})

test('wrong targets and requests addressed to another GCS cannot advance upload', () => {
  const { upload, sent } = harness()
  upload.start(items)
  assert.equal(upload.ingestEnvelope(ack(1)), false)
  upload.ingestEnvelope(ack())
  assert.equal(upload.ingestEnvelope(request(0, { targetSystem: 42 })), false)
  assert.equal(sent.length, 2)
})

test('serves legacy MISSION_REQUEST with MISSION_ITEM and tolerates its float coordinate precision', () => {
  const { upload, sent } = harness()
  upload.start(items); upload.ingestEnvelope(ack()); upload.ingestEnvelope(legacyRequest(0)); upload.ingestEnvelope(legacyRequest(1)); upload.ingestEnvelope(ack())
  assert.deepEqual(sent.map((frame) => frame[5]), [45, 44, 39, 39])
  const quantized = items.map((item, seq) => ({ ...item, seq, param1: 0, param2: 0, param3: 0, param4: 0,
    latDegE7: item.latDegE7 + 50, lonDegE7: item.lonDegE7 - 50 }))
  upload.confirmReadback(quantized)
  assert.equal(upload.getState().status, 'complete')
})

test('negative ACK, invalid sequence, premature ACK, and read-back mismatch fail closed', () => {
  const rejected = harness(); rejected.upload.start(items); rejected.upload.ingestEnvelope(ack(2, 3))
  assert.match(rejected.upload.getState().reason, /clear rejected/)

  const invalid = harness(); invalid.upload.start(items); invalid.upload.ingestEnvelope(ack()); invalid.upload.ingestEnvelope(request(9))
  assert.match(invalid.upload.getState().reason, /invalid mission sequence/)

  const premature = harness(); premature.upload.start(items); premature.upload.ingestEnvelope(ack()); premature.upload.ingestEnvelope(ack())
  assert.match(premature.upload.getState().reason, /before requesting every item/)

  const mismatch = harness(); mismatch.upload.start(items); mismatch.upload.ingestEnvelope(ack());
  mismatch.upload.ingestEnvelope(request(0)); mismatch.upload.ingestEnvelope(request(1)); mismatch.upload.ingestEnvelope(ack())
  mismatch.upload.confirmReadback([{ ...items[0], seq: 0 }])
  assert.match(mismatch.upload.getState().reason, /read-back did not match/)
})

test('timeouts retry identical bytes within budget and route loss fails', () => {
  const timed = harness(); timed.upload.start(items); const original = Buffer.from(timed.sent[0])
  timed.advance(101); assert.equal(timed.upload.tick(), true); assert.deepEqual(timed.sent[1], original)
  timed.advance(101); timed.upload.tick(); assert.equal(timed.upload.getState().status, 'failed')

  const lost = harness({ sendResult: false }); lost.upload.start(items)
  assert.equal(lost.upload.getState().status, 'failed')
  assert.match(lost.upload.getState().reason, /route disappeared/)
})

test('mission input is bounded and normalized without transport-specific types', () => {
  assert.throws(() => harness().upload.start([]), /1..65535/)
  assert.throws(() => harness().upload.start([{ ...items[0], latDegE7: 1.5 }]), /coordinates/)
  assert.throws(() => harness().upload.start([{ ...items[0], current: 1 }]), /boolean/)
  assert.throws(() => createMissionUpload({ targetSystemId: 0, targetComponentId: 1, send() {} }), /non-broadcast/)
})
