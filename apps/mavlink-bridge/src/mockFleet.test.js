import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockFleet } from './mockFleet.js'
import { MOCK_NODES, selectNodes } from './mockNodes.js'
import { encodeMissionRequestInt, encodeMissionRequestList } from './encode.js'
import { parseIncomingDatagram } from './normalize.js'

const GCS = { sysId: 255, compId: 190 }

/** Drives the fleet from a controllable clock instead of the wall. */
function fleetAt(startMs = 1_700_000_000_000, nodes = MOCK_NODES) {
  let clock = startMs
  const fleet = createMockFleet({ nodes, now: () => clock })
  return {
    fleet,
    advance(ms) {
      clock += ms
      return fleet.tick(clock)
    },
  }
}

/** Decodes a mock reply through the bridge's own parser, as the real path would. */
function decodeReplies(frames) {
  return frames.flatMap((frame) => parseIncomingDatagram(frame, 0).envelopes)
}

function positionOf(envelopes, sysId) {
  const frame = envelopes.find((e) => e.sysId === sysId && e.messageName === 'GLOBAL_POSITION_INT')
  return frame.payload.globalPositionInt
}

// ---------------------------------------------------------------------------
// Roster invariants
// ---------------------------------------------------------------------------

test('every node in the roster has a distinct sysId', () => {
  // Two nodes sharing a sysId merge into one aircraft with contradictory
  // telemetry — the exact failure the bridge's conflict detector exists to catch.
  const keys = MOCK_NODES.map((node) => `${node.sysId}:${node.compId}`)
  assert.equal(new Set(keys).size, MOCK_NODES.length)
  assert.equal(new Set(MOCK_NODES.map((node) => node.id)).size, MOCK_NODES.length)
})

test('the roster ships a snake node and a figure-eight node', () => {
  assert.deepEqual(MOCK_NODES.map((node) => node.id), ['snake-01', 'figure8-01'])
  assert.equal(MOCK_NODES[0].sysId, 1, 'snake stays sysId 1 so the existing single-node setup is unchanged')
  assert.equal(MOCK_NODES[1].sysId, 2)
})

test('the figure-eight mission has four waypoints at positive relative altitude', () => {
  const mission = MOCK_NODES[1].mission
  assert.equal(mission.length, 4)
  assert.deepEqual(mission.map((item) => item.seq), [0, 1, 2, 3])
  mission.forEach((item) => assert.ok(item.altM > 0, `waypoint ${item.seq} alt ${item.altM}`))
})

test('selectNodes subsets by id, defaults to the whole roster, and rejects typos', () => {
  assert.deepEqual(selectNodes('').map((node) => node.id), ['snake-01', 'figure8-01'])
  assert.deepEqual(selectNodes(undefined).map((node) => node.id), ['snake-01', 'figure8-01'])
  // The single-stream test mode.
  assert.deepEqual(selectNodes('snake-01').map((node) => node.id), ['snake-01'])
  assert.deepEqual(selectNodes(' figure8-01 , snake-01 ').map((node) => node.id), ['figure8-01', 'snake-01'])
  // Loud, not silent: a typo would otherwise look like a node that failed to appear.
  assert.throws(() => selectNodes('figure-8'), /unknown mock node/)
})

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

test('tick emits a full message set for every node, under its own identity', () => {
  const envelopes = fleetAt().advance(150)
  const expected = ['HEARTBEAT', 'ATTITUDE', 'VFR_HUD', 'GLOBAL_POSITION_INT', 'GPS_RAW_INT']

  for (const node of MOCK_NODES) {
    const mine = envelopes.filter((e) => e.sysId === node.sysId && e.compId === node.compId)
    assert.deepEqual(mine.map((e) => e.messageName), expected, `node ${node.id}`)
  }

  assert.equal(envelopes.length, expected.length * MOCK_NODES.length)
})

test('each node runs its own sequence counter', () => {
  // Shared counters would make every node look like it were dropping packets.
  const harness = fleetAt()
  harness.advance(150)
  const envelopes = harness.advance(150)

  for (const node of MOCK_NODES) {
    const sequences = envelopes.filter((e) => e.sysId === node.sysId).map((e) => e.sequence)
    assert.deepEqual(sequences, [6, 7, 8, 9, 10], `node ${node.id}`)
  }
})

test('nodes report positions around their own distinct origins', () => {
  const envelopes = fleetAt().advance(150)
  const snake = positionOf(envelopes, 1)
  const figureEight = positionOf(envelopes, 2)

  assert.notEqual(snake.latDegE7, figureEight.latDegE7)
  assert.notEqual(snake.lonDegE7, figureEight.lonDegE7)
  // Close enough to share a map view, far enough not to overlap.
  const northM = Math.abs(snake.latDegE7 - figureEight.latDegE7) / 1e7 * 111319.49
  assert.ok(northM > 100 && northM < 5000, `origins ${northM.toFixed(0)} m apart`)
})

test('the figure-eight node holds its ground while the snake node travels', () => {
  // The reason the figure eight is analytic: it must still be in the same place
  // after many laps, so the map can stay put.
  const harness = fleetAt()
  const first = harness.advance(150)

  for (let index = 0; index < 400; index += 1) {
    harness.advance(150)
  }

  const later = harness.advance(150)
  const spanM = (a, b) => Math.hypot(
    (a.latDegE7 - b.latDegE7) / 1e7 * 111319.49,
    (a.lonDegE7 - b.lonDegE7) / 1e7 * 75383,
  )

  // 60 s of ticks: the figure eight stays inside its ~300x200 m envelope...
  assert.ok(spanM(positionOf(first, 2), positionOf(later, 2)) < 400, 'figure eight drifted out of its envelope')
  // ...while the snake has flown off, which is what it is for.
  assert.ok(spanM(positionOf(first, 1), positionOf(later, 1)) > 900, 'snake should have travelled')
})

test('reported yaw agrees with reported heading', () => {
  // They disagreed by 180 deg in the original mock, which put the orientation
  // wireframe opposite the map track.
  for (const envelopes of [fleetAt().advance(150), fleetAt().advance(9_000)]) {
    for (const node of MOCK_NODES) {
      const attitude = envelopes.find((e) => e.sysId === node.sysId && e.messageName === 'ATTITUDE')
      const vfr = envelopes.find((e) => e.sysId === node.sysId && e.messageName === 'VFR_HUD')
      const yawDeg = ((attitude.payload.attitude.yawRad * 180) / Math.PI + 360) % 360
      const delta = Math.abs(((yawDeg - vfr.payload.vfrHud.headingDeg + 540) % 360) - 180)
      assert.ok(delta < 1e-6, `node ${node.id}: yaw ${yawDeg} vs heading ${vfr.payload.vfrHud.headingDeg}`)
    }
  }
})

test('createMockFleet rejects an empty roster or an unknown profile', () => {
  assert.throws(() => createMockFleet({ nodes: [] }), /at least one node/)
  assert.throws(
    () => createMockFleet({ nodes: [{ ...MOCK_NODES[0], profile: 'barrel-roll' }] }),
    /unknown flight profile/,
  )
})

// ---------------------------------------------------------------------------
// Mission handshake — the reason decodeMissionRequest had to learn the target
// ---------------------------------------------------------------------------

test('a mission request reaches only the node it addresses', () => {
  // The crux of multi-node missions. Before target decoding, every node answered
  // every request and the last reply won — under the wrong system key.
  const { fleet } = fleetAt()

  const forNodeTwo = decodeReplies(fleet.handleMissionRequest(
    encodeMissionRequestList({ ...GCS, targetSystemId: 2, targetComponentId: 1 }),
  ))

  assert.equal(forNodeTwo.length, 1)
  assert.equal(forNodeTwo[0].sysId, 2)
  assert.equal(forNodeTwo[0].messageName, 'MISSION_COUNT')
  assert.equal(forNodeTwo[0].payload.missionCount.count, 4)

  const forNodeOne = decodeReplies(fleet.handleMissionRequest(
    encodeMissionRequestList({ ...GCS, targetSystemId: 1, targetComponentId: 1 }),
  ))

  assert.equal(forNodeOne.length, 1)
  assert.equal(forNodeOne[0].sysId, 1)
  // Different counts prove the two plans are genuinely distinct, not one shared plan.
  assert.equal(forNodeOne[0].payload.missionCount.count, 3)
})

test('mission items come back from the addressed node, with its own coordinates', () => {
  const { fleet } = fleetAt()

  const itemFor = (targetSystemId, seq) => {
    const replies = decodeReplies(fleet.handleMissionRequest(
      encodeMissionRequestInt({ ...GCS, targetSystemId, targetComponentId: 1, seq }),
    ))
    assert.equal(replies.length, 1)
    assert.equal(replies[0].sysId, targetSystemId)
    assert.equal(replies[0].messageName, 'MISSION_ITEM_INT')
    return replies[0].payload.missionItemInt
  }

  const snakeItem = itemFor(1, 1)
  const figureEightItem = itemFor(2, 1)

  assert.equal(snakeItem.seq, 1)
  assert.equal(figureEightItem.seq, 1)
  assert.notEqual(snakeItem.latDegE7, figureEightItem.latDegE7)
  assert.deepEqual(
    { lat: figureEightItem.latDegE7, lon: figureEightItem.lonDegE7 },
    { lat: MOCK_NODES[1].mission[1].latDegE7, lon: MOCK_NODES[1].mission[1].lonDegE7 },
  )
})

test('a request for a seq the addressed node does not have is answered with nothing', () => {
  const { fleet } = fleetAt()
  // seq 3 exists on the figure-eight node (4 items) but not on the snake node (3).
  assert.deepEqual(fleet.handleMissionRequest(
    encodeMissionRequestInt({ ...GCS, targetSystemId: 1, targetComponentId: 1, seq: 3 }),
  ), [])
  assert.equal(decodeReplies(fleet.handleMissionRequest(
    encodeMissionRequestInt({ ...GCS, targetSystemId: 2, targetComponentId: 1, seq: 3 }),
  )).length, 1)
})

test('a broadcast request is answered by every node', () => {
  // target_system 0 means "all systems"; a real autopilot answers it, so these do.
  const { fleet } = fleetAt()
  const replies = decodeReplies(fleet.handleMissionRequest(
    encodeMissionRequestList({ ...GCS, targetSystemId: 0, targetComponentId: 0 }),
  ))

  assert.deepEqual(replies.map((reply) => reply.sysId).sort(), [1, 2])
})

test('a request for a system that is not on the link is answered with nothing', () => {
  const { fleet } = fleetAt()
  assert.deepEqual(fleet.handleMissionRequest(
    encodeMissionRequestList({ ...GCS, targetSystemId: 9, targetComponentId: 1 }),
  ), [])
})

test('a request addressed to the right system but the wrong component is ignored', () => {
  const { fleet } = fleetAt()
  assert.deepEqual(fleet.handleMissionRequest(
    encodeMissionRequestList({ ...GCS, targetSystemId: 1, targetComponentId: 42 }),
  ), [])
})

test('a datagram that is not a mission request is ignored', () => {
  const { fleet } = fleetAt()
  assert.deepEqual(fleet.handleMissionRequest(Buffer.from('not a mavlink frame')), [])
})

test('the same request answered twice gives identical plans', () => {
  // No state across calls, matching a real autopilot.
  const { fleet } = fleetAt()
  const request = encodeMissionRequestInt({ ...GCS, targetSystemId: 2, targetComponentId: 1, seq: 2 })
  const first = decodeReplies(fleet.handleMissionRequest(request))[0].payload.missionItemInt
  const second = decodeReplies(fleet.handleMissionRequest(request))[0].payload.missionItemInt
  assert.deepEqual(first, second)
})

// ---------------------------------------------------------------------------
// Single-stream mode
// ---------------------------------------------------------------------------

test('a single-node selection produces exactly one system on the link', () => {
  const envelopes = fleetAt(1_700_000_000_000, selectNodes('snake-01')).advance(150)
  assert.deepEqual([...new Set(envelopes.map((e) => e.sysId))], [1])

  const { fleet } = fleetAt(1_700_000_000_000, selectNodes('snake-01'))
  // Even a broadcast only reaches the node that is actually flying.
  assert.equal(fleet.handleMissionRequest(
    encodeMissionRequestList({ ...GCS, targetSystemId: 0, targetComponentId: 0 }),
  ).length, 1)
})
