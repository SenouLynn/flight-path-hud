import assert from 'node:assert/strict'
import test from 'node:test'
import { MAV_MISSION_ACCEPTED } from './encode.js'
import { createMissionSync, MAX_RETRIES, MISSION_ITEM_TIMEOUT_MS } from './missionSync.js'

function makeSync(overrides = {}) {
  const sent = []
  let nowMs = 0
  const sync = createMissionSync({
    send: (buffer) => sent.push(buffer),
    now: () => nowMs,
    sysId: 255,
    compId: 190,
    targetSystemId: 1,
    targetComponentId: 1,
    ...overrides,
  })
  return { sync, sent, advance: (deltaMs) => { nowMs += deltaMs } }
}

function missionCountEnvelope(count) {
  return { sysId: 1, compId: 1, messageName: 'MISSION_COUNT', payload: { missionCount: { count } } }
}

function missionItemEnvelope(item) {
  return { sysId: 1, compId: 1, messageName: 'MISSION_ITEM_INT', payload: { missionItemInt: item } }
}

function missionAckEnvelope(type) {
  return { sysId: 1, compId: 1, messageName: 'MISSION_ACK', payload: { missionAck: { type } } }
}

test('idle until requestMission() is called', () => {
  const { sync } = makeSync()
  assert.equal(sync.getState().status, 'idle')
})

test('happy path: count=0 completes immediately with an ack, no items to fetch', () => {
  const { sync, sent } = makeSync()
  sync.requestMission()
  assert.equal(sync.getState().status, 'requested')
  assert.equal(sent.length, 1) // MISSION_REQUEST_LIST

  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.getState().status, 'complete')
  assert.deepEqual(sync.getState().items, [])
  assert.equal(sent.length, 2) // + MISSION_ACK
})

test('happy path: two items collected in order, then acked', () => {
  const { sync, sent } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(2))
  assert.equal(sync.getState().status, 'collecting')
  assert.equal(sent.length, 2) // MISSION_REQUEST_LIST + MISSION_REQUEST_INT(seq=0)

  sync.ingestEnvelope(missionItemEnvelope({ seq: 0, command: 16, current: false, autocontinue: true, latDegE7: 1, lonDegE7: 2, altM: 3 }))
  assert.equal(sync.getState().status, 'collecting')
  assert.equal(sent.length, 3) // + MISSION_REQUEST_INT(seq=1)

  sync.ingestEnvelope(missionItemEnvelope({ seq: 1, command: 17, current: true, autocontinue: true, latDegE7: 4, lonDegE7: 5, altM: 6 }))
  assert.equal(sync.getState().status, 'complete')
  assert.equal(sent.length, 4) // + MISSION_ACK
  assert.equal(sync.getState().items.length, 2)
  assert.equal(sync.getState().items[1].seq, 1)
})

test('acknowledgePublished() moves complete -> published, and is a no-op otherwise', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.getState().status, 'complete')

  sync.acknowledgePublished()
  assert.equal(sync.getState().status, 'published')

  sync.acknowledgePublished() // already published — no-op, doesn't throw
  assert.equal(sync.getState().status, 'published')
})

test('out-of-sequence item is dropped and the expected index is re-requested', () => {
  const { sync, sent } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(2))
  const sentBefore = sent.length

  sync.ingestEnvelope(missionItemEnvelope({ seq: 1, command: 1, current: false, autocontinue: true, latDegE7: 0, lonDegE7: 0, altM: 0 }))
  assert.equal(sync.getState().status, 'collecting', 'still waiting for seq 0')
  assert.equal(sent.length, sentBefore + 1, 'one re-request sent')
  assert.equal(sync.getState().items.length, 0, 'nothing recorded')
})

test('MISSION_CURRENT updates activeIndex passively, independent of pull status', () => {
  const { sync } = makeSync()
  sync.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'MISSION_CURRENT', payload: { missionCurrent: { seq: 3 } } })
  assert.equal(sync.getState().activeIndex, 3)
  assert.equal(sync.getState().status, 'idle', 'a status-changing message this is not')
})

test('a spurious MAV_MISSION_INVALID_SEQUENCE ack mid-flight is ignored (ArduPilot quirk)', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))

  sync.ingestEnvelope(missionAckEnvelope(13)) // MAV_MISSION_INVALID_SEQUENCE
  assert.equal(sync.getState().status, 'collecting', 'not treated as fatal')
})

test('any other MAV_MISSION_RESULT error is unrecoverable', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))

  sync.ingestEnvelope(missionAckEnvelope(1)) // MAV_MISSION_ERROR
  const state = sync.getState()
  assert.equal(state.status, 'failed')
  assert.match(state.reason, /MAV_MISSION_RESULT=1/)
})

test('retries MISSION_REQUEST_INT on a 250ms timeout, up to 5 times, then fails', () => {
  const { sync, sent, advance } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))
  const sentAfterFirstRequest = sent.length

  for (let retry = 1; retry <= 5; retry += 1) {
    advance(250)
    const changed = sync.tick()
    assert.equal(changed, true, `retry ${retry} should re-send`)
  }
  assert.equal(sent.length, sentAfterFirstRequest + 5)
  assert.equal(sync.getState().status, 'collecting', 'still within budget after 5 retries')

  advance(250)
  sync.tick()
  assert.equal(sync.getState().status, 'failed')
  assert.match(sync.getState().reason, /timed out/)
})

test('retries MISSION_REQUEST_LIST on a 1500ms timeout while awaiting MISSION_COUNT', () => {
  const { sync, sent, advance } = makeSync()
  sync.requestMission()
  const sentAfterFirstRequest = sent.length

  advance(1500)
  assert.equal(sync.tick(), true)
  assert.equal(sent.length, sentAfterFirstRequest + 1)
  assert.equal(sync.getState().status, 'requested')
})

test('tick() is a no-op before any request and after completion', () => {
  const { sync } = makeSync()
  assert.equal(sync.tick(), false)

  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.tick(), false, 'nothing outstanding once complete')
})

test('tick() never retries/fails a completed mission, no matter how much time passes', () => {
  const { sync, sent, advance } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.getState().status, 'complete')
  const sentAfterComplete = sent.length

  advance(MISSION_ITEM_TIMEOUT_MS * (MAX_RETRIES + 2))
  assert.equal(sync.tick(), false, 'a completed mission has nothing outstanding to retry')
  assert.equal(sync.getState().status, 'complete', 'still complete, not corrupted into failed')
  assert.equal(sent.length, sentAfterComplete, 'no spurious re-sends')

  sync.acknowledgePublished()
  assert.equal(sync.getState().status, 'published')

  advance(MISSION_ITEM_TIMEOUT_MS * (MAX_RETRIES + 2))
  assert.equal(sync.tick(), false, 'a published mission has nothing outstanding to retry either')
  assert.equal(sync.getState().status, 'published', 'still published, not corrupted into failed')
})

test('requestMission() after a failure starts a fresh attempt', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))
  sync.ingestEnvelope(missionAckEnvelope(1)) // fail it
  assert.equal(sync.getState().status, 'failed')

  sync.requestMission()
  assert.equal(sync.getState().status, 'requested')
  assert.equal(sync.getState().reason, null)
})
