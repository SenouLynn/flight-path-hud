import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBridgeCore } from './bridgeCore.js'
import { createMissionRouter } from './missionRouter.js'
import { readRecording } from './recording.js'

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test-fixtures/mixed-sitl-motion-v2.jsonl',
)

function replayFrames() {
  const core = createBridgeCore({ now: () => 0 })
  return readRecording(fixture).flatMap(({ data, atMs }) => core.ingestDatagram(data, atMs))
}

function distanceM(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180
  const lat1 = radians(first.latDegE7 / 1e7)
  const lat2 = radians(second.latDegE7 / 1e7)
  const dLat = lat2 - lat1
  const dLon = radians((second.lonDegE7 - first.lonDegE7) / 1e7)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}

function collectSystems(frames) {
  const systems = new Map()

  for (const frame of frames) {
    const key = `${frame.sysId}:${frame.compId}`
    const system = systems.get(key) ?? {
      positions: [], attitudes: [], missionCurrent: [], missionItems: [], messageNames: new Set(),
    }
    system.messageNames.add(frame.messageName)
    if (frame.payload.globalPositionInt !== undefined) system.positions.push(frame.payload.globalPositionInt)
    if (frame.payload.attitude !== undefined) system.attitudes.push(frame.payload.attitude)
    if (frame.payload.missionCurrent !== undefined) system.missionCurrent.push(frame.payload.missionCurrent.seq)
    if (frame.payload.missionItemInt !== undefined) system.missionItems.push(frame.payload.missionItemInt.seq)
    systems.set(key, system)
  }

  return systems
}

test('motion fixture proves independent, coherent movement for Copter and Plane', () => {
  const systems = collectSystems(replayFrames())
  assert.deepEqual([...systems.keys()].sort(), ['1:1', '2:1'])

  for (const [key, system] of systems) {
    assert.ok(system.messageNames.has('HEARTBEAT'), `${key} heartbeat`)
    assert.ok(system.positions.length >= 5, `${key} position samples`)
    assert.ok(system.attitudes.length >= 5, `${key} attitude samples`)

    const displacement = system.positions.map((position) => distanceM(system.positions[0], position))
    assert.ok(Math.max(...displacement) >= 75, `${key} moved at least 75 m`)

    const segments = system.positions.slice(1)
      .map((position, index) => distanceM(system.positions[index], position))
    assert.ok(segments.filter((distance) => distance >= 1).length >= 3, `${key} has distinct trail points`)
    assert.ok(Math.max(...segments) < 1000, `${key} has no false trail epoch jump`)

    const speeds = system.positions.map((position) => Math.hypot(position.vxCms, position.vyCms) / 100)
    assert.ok(Math.max(...speeds) >= 5, `${key} reports meaningful ground speed`)
    assert.ok(new Set(system.positions.map((position) => position.headingCdeg)).size >= 3, `${key} heading changes`)
    assert.ok(Math.max(...system.positions.map((position) => position.relativeAltMm)) >= 10_000, `${key} climbs`)

    const rolls = system.attitudes.map((attitude) => attitude.rollRad)
    assert.ok(Math.max(...rolls) - Math.min(...rolls) >= 0.1, `${key} attitude changes`)
  }

  assert.notDeepEqual(systems.get('1:1').positions, systems.get('2:1').positions)
})

test('motion fixture retains target-scoped mission progress and passive overlays', () => {
  const frames = replayFrames()
  const systems = collectSystems(frames)

  assert.deepEqual([...new Set(systems.get('1:1').missionItems)].sort(), [0, 1, 2, 3, 4])
  assert.deepEqual([...new Set(systems.get('2:1').missionItems)].sort(), [0, 1, 2, 3, 4])
  assert.ok(systems.get('1:1').missionCurrent.includes(2))
  assert.ok(systems.get('2:1').missionCurrent.includes(2))

  const router = createMissionRouter({
    send: () => assert.fail('passive replay must not emit MAVLink'),
    canSend: () => false,
    isLive: () => false,
  })
  frames.forEach((frame) => router.ingestEnvelope(frame))

  const overlays = router.snapshotForNewClient()
    .filter((frame) => frame.type === 'mission')
    .sort((left, right) => left.sysId - right.sysId)
  assert.deepEqual(overlays.map((mission) => ({
    target: `${mission.sysId}:${mission.compId}`,
    items: mission.items.map((item) => item.seq),
  })), [
    { target: '1:1', items: [0, 1, 2, 3, 4] },
    { target: '2:1', items: [0, 1, 2, 3, 4] },
  ])
})

test('motion fixture normalized replay is deterministic', () => {
  const first = replayFrames()
  assert.ok(first.length > 0)
  assert.deepEqual(replayFrames(), first)
})
