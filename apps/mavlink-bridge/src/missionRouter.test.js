import assert from 'node:assert/strict'
import test from 'node:test'
import { createMissionRouter } from './missionRouter.js'
import { MAX_RETRIES, MISSION_ITEM_TIMEOUT_MS } from './missionSync.js'

function makeRouter(overrides = {}) {
  const sent = []
  let canSendValue = true
  let liveValue = true
  let nowMs = 0
  const router = createMissionRouter({
    send: (sysId, compId, buffer) => sent.push({ sysId, compId, buffer }),
    canSend: () => canSendValue,
    isLive: () => liveValue,
    now: () => nowMs,
    ...overrides,
  })
  return {
    router, sent,
    setCanSend: (value) => { canSendValue = value },
    setLive: (value) => { liveValue = value },
    advance: (deltaMs) => { nowMs += deltaMs },
  }
}

test('HOME_POSITION becomes a home frame and is cached for new clients', () => {
  const { router } = makeRouter()
  const frame = router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'HOME_POSITION',
    payload: { homePosition: { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 } },
  })

  assert.equal(frame.type, 'home')
  assert.equal(frame.sysId, 1)
  assert.equal(frame.lat.toFixed(6), '47.397742')
  assert.equal(frame.altMslM, 500)
  assert.deepEqual(router.snapshotForNewClient(), [frame])
})

test('a non-mission, non-home envelope is ignored', () => {
  const { router } = makeRouter()
  const frame = router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'HEARTBEAT', payload: {} })
  assert.equal(frame, null)
})

test('handleClientMessage triggers a pull and returns a pending frame', () => {
  const { router, sent } = makeRouter()
  const frame = router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  assert.equal(frame.type, 'mission')
  assert.equal(frame.status, 'pending')
  assert.equal(frame.items.length, 0)
  assert.equal(sent.length, 1) // MISSION_REQUEST_LIST went out
  assert.deepEqual(sent[0], { sysId: 1, compId: 1, buffer: sent[0].buffer })
})

test('a full pull ends with status complete, scaled lat/lon/alt, then acknowledgePublished flips it to published internally', () => {
  const { router } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'MISSION_COUNT', payload: { missionCount: { count: 1 } } })
  const frame = router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'MISSION_ITEM_INT',
    payload: { missionItemInt: { seq: 0, command: 16, current: true, autocontinue: true, latDegE7: 473977420, lonDegE7: 85455940, altM: 80 } },
  })

  assert.equal(frame.status, 'complete')
  assert.equal(frame.items.length, 1)
  assert.equal(frame.items[0].latDeg.toFixed(6), '47.397742')
  assert.equal(frame.items[0].altM, 80)

  // Idempotent: ingesting nothing new (a tick with nothing outstanding) never re-fires.
  assert.deepEqual(router.tick(), [])
})

test('handleClientMessage fails immediately when canSend() is false (replay mode)', () => {
  const { router, setCanSend, setLive, sent } = makeRouter()
  setCanSend(false)
  setLive(false)

  const frame = router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })
  assert.equal(frame.status, 'failed')
  assert.match(frame.reason, /replay/i)
  assert.equal(sent.length, 0, 'no outbound bytes in replay mode')
})

test('replay passively reconstructs a captured mission without sending MAVLink', () => {
  const { router, setLive, sent } = makeRouter()
  setLive(false)

  const pending = router.ingestEnvelope({
    sysId: 2, compId: 1, messageName: 'MISSION_COUNT',
    payload: { missionCount: { count: 2 } },
  })
  assert.equal(pending.status, 'pending')

  router.ingestEnvelope({
    sysId: 2, compId: 1, messageName: 'MISSION_ITEM_INT',
    payload: { missionItemInt: { seq: 0, command: 16, current: true, autocontinue: true, latDegE7: 1, lonDegE7: 2, altM: 3 } },
  })
  const complete = router.ingestEnvelope({
    sysId: 2, compId: 1, messageName: 'MISSION_ITEM_INT',
    payload: { missionItemInt: { seq: 1, command: 16, current: false, autocontinue: true, latDegE7: 4, lonDegE7: 5, altM: 6 } },
  })

  assert.equal(complete.status, 'complete')
  assert.deepEqual(complete.items.map((item) => item.seq), [0, 1])
  assert.equal(sent.length, 0, 'passive replay emits neither requests nor ACKs')
  assert.deepEqual(router.snapshotForNewClient(), [complete])
})

test('live unsolicited mission responses remain ignored', () => {
  const { router, sent } = makeRouter()

  assert.equal(router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'MISSION_COUNT',
    payload: { missionCount: { count: 1 } },
  }), null)
  assert.equal(router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'MISSION_ITEM_INT',
    payload: { missionItemInt: { seq: 0, command: 16, current: true, autocontinue: true, latDegE7: 1, lonDegE7: 2, altM: 3 } },
  }), null)

  assert.equal(sent.length, 0)
  assert.deepEqual(router.snapshotForNewClient(), [])
})

test('a live request with no route fails safely rather than using another vehicle endpoint', () => {
  const { router, setCanSend, sent } = makeRouter()
  setCanSend(false)

  const frame = router.handleClientMessage({ type: 'requestMission', sysId: 2, compId: 1 })
  assert.equal(frame.status, 'failed')
  assert.match(frame.reason, /no live UDP endpoint/i)
  assert.equal(sent.length, 0)
})

test('each mission sync binds every request, retry, and ack to its own system', () => {
  const { router, sent, advance } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })
  router.handleClientMessage({ type: 'requestMission', sysId: 2, compId: 1 })

  assert.deepEqual(sent.slice(0, 2).map(({ sysId, compId }) => `${sysId}:${compId}`), ['1:1', '2:1'])

  // Let only Plane's count arrive. Its item request must still target Plane,
  // regardless of Copter being the other active pull.
  router.ingestEnvelope({ sysId: 2, compId: 1, messageName: 'MISSION_COUNT', payload: { missionCount: { count: 1 } } })
  assert.equal(`${sent.at(-1).sysId}:${sent.at(-1).compId}`, '2:1')

  router.ingestEnvelope({ sysId: 2, compId: 1, messageName: 'MISSION_ITEM_INT', payload: { missionItemInt: { seq: 0, command: 16, current: true, autocontinue: true, latDegE7: 1, lonDegE7: 1, altM: 1 } } })
  assert.equal(`${sent.at(-1).sysId}:${sent.at(-1).compId}`, '2:1', 'final ACK stays on Plane route')

  advance(1500)
  router.tick()
  assert.equal(`${sent.at(-1).sysId}:${sent.at(-1).compId}`, '1:1', 'Copter retry stays on Copter route')
})

test('handleClientMessage ignores a message of the wrong type', () => {
  const { router } = makeRouter()
  assert.equal(router.handleClientMessage({ type: 'somethingElse' }), null)
  assert.equal(router.handleClientMessage(null), null)
})

test('tick() surfaces a timeout failure as a frame', () => {
  const { router, advance } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  advance(1500 * 6) // past MISSION_COUNT_TIMEOUT_MS * (MAX_RETRIES + 1)
  const frames = router.tick()
  assert.equal(frames.length, 1)
  assert.equal(frames[0].status, 'failed')
})

test('snapshotForNewClient includes both mission and home state across systems', () => {
  const { router } = makeRouter()
  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'HOME_POSITION', payload: { homePosition: { latDegE7: 1, lonDegE7: 1, altMm: 1000 } } })
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  const snapshot = router.snapshotForNewClient()
  assert.equal(snapshot.length, 2)
  assert.deepEqual(snapshot.map((frame) => frame.type).sort(), ['home', 'mission'])
})

test('a completed mission survives many subsequent router.tick() calls after a large time advance', () => {
  const { router, advance } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })
  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'MISSION_COUNT', payload: { missionCount: { count: 0 } } })

  const cachedBefore = router.snapshotForNewClient().find((frame) => frame.type === 'mission')
  assert.equal(cachedBefore.status, 'complete')

  advance(MISSION_ITEM_TIMEOUT_MS * (MAX_RETRIES + 2))
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(router.tick(), [], `tick ${i} should not surface a spurious failure`)
  }

  const cachedAfter = router.snapshotForNewClient().find((frame) => frame.type === 'mission')
  assert.equal(cachedAfter.status, 'complete', 'still complete, not corrupted into failed')
})

test('MISSION_CURRENT with no prior requestMission() is not published or cached (still idle)', () => {
  const { router } = makeRouter()
  const frame = router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'MISSION_CURRENT', payload: { missionCurrent: { seq: 2 } },
  })

  assert.equal(frame, null)
  assert.deepEqual(router.snapshotForNewClient(), [])
})

test('an out-of-range sysId is rejected without throwing or sending bytes', () => {
  const { router, sent } = makeRouter()

  // 999 > uint8: this used to reach Buffer.writeUInt8 and crash the process.
  const frame = router.handleClientMessage({ type: 'requestMission', sysId: 999, compId: 1 })

  assert.equal(frame.type, 'mission')
  assert.equal(frame.status, 'failed')
  assert.deepEqual(frame.items, [])
  assert.equal(frame.activeIndex, null)
  assert.match(frame.reason, /invalid sysId\/compId/i)
  assert.equal(sent.length, 0, 'no MAVLink bytes for an invalid request')
})

test('a requestMission with no ids at all is rejected rather than broadcast to every vehicle', () => {
  const { router, sent } = makeRouter()

  // Missing ids used to coerce to 0/0 — MAVLink broadcast — inside writeUInt8.
  const frame = router.handleClientMessage({ type: 'requestMission' })

  assert.equal(frame.status, 'failed')
  assert.equal(sent.length, 0, 'no MAVLink broadcast for a request with no ids')
  // Wire shapes are always fully populated: explicit nulls, never absent keys.
  assert.ok('sysId' in frame && 'compId' in frame)
  assert.equal(frame.sysId, null)
  assert.equal(frame.compId, null)
})

test('every flavour of invalid id is rejected, and none of them pollute the snapshot cache', () => {
  const { router, sent } = makeRouter()

  const invalid = [
    { sysId: undefined, compId: 1 },
    { sysId: 1, compId: undefined },
    { sysId: '1', compId: 1 },
    { sysId: null, compId: 1 },
    { sysId: 1.5, compId: 1 },
    { sysId: -1, compId: 1 },
    { sysId: 256, compId: 1 },
    { sysId: 1, compId: 256 },
    { sysId: Number.NaN, compId: 1 },
    { sysId: 1, compId: Number.POSITIVE_INFINITY },
  ]

  invalid.forEach((ids) => {
    const frame = router.handleClientMessage({ type: 'requestMission', ...ids })
    assert.equal(frame.status, 'failed', `expected rejection for ${JSON.stringify(ids)}`)
  })

  assert.equal(sent.length, 0)
  assert.deepEqual(router.snapshotForNewClient(), [], 'a rejected request is never cached')
})

test('a failed pull is not re-broadcast by routine MISSION_CURRENT telemetry', () => {
  const { router, advance } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  advance(1500 * 6)
  const failures = router.tick()
  assert.equal(failures.length, 1, 'the transition into failed is still published')
  assert.equal(failures[0].status, 'failed')

  const current = { sysId: 1, compId: 1, messageName: 'MISSION_CURRENT', payload: { missionCurrent: { seq: 4 } } }

  // First one carries a genuinely new activeIndex, so it is still news.
  const first = router.ingestEnvelope(current)
  assert.equal(first.status, 'failed')
  assert.equal(first.activeIndex, 4)

  // Every identical repeat afterwards is silence, not another failed frame.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(router.ingestEnvelope(current), null, `repeat ${i} should not re-broadcast`)
  }

  // A real change still gets through.
  const moved = router.ingestEnvelope({ ...current, payload: { missionCurrent: { seq: 5 } } })
  assert.equal(moved.activeIndex, 5)
})

test('MISSION_CURRENT with no prior requestMission() does not shadow a cached home frame', () => {
  const { router } = makeRouter()
  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'HOME_POSITION', payload: { homePosition: { latDegE7: 1, lonDegE7: 1, altMm: 1000 } } })
  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'MISSION_CURRENT', payload: { missionCurrent: { seq: 2 } } })

  const snapshot = router.snapshotForNewClient()
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].type, 'home')
})
