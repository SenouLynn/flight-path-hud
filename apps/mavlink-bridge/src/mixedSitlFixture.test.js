import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBridgeCore } from './bridgeCore.js'
import { readRecording } from './recording.js'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures/mixed-mavlink-v2.jsonl')

function replayFrames() {
  const core = createBridgeCore({ now: () => 0 })
  return readRecording(fixture).flatMap(({ data, atMs }) => core.ingestDatagram(data, atMs))
}

test('mixed MAVLink v2 fixture keeps Copter and Plane telemetry independent', () => {
  const frames = replayFrames()
  const systems = new Map()

  frames.forEach((frame) => {
    const key = `${frame.sysId}:${frame.compId}`
    const system = systems.get(key) ?? { messageNames: new Set(), positions: [], missionCount: null, missionItems: [] }
    system.messageNames.add(frame.messageName)
    if (frame.payload.globalPositionInt !== undefined) {
      system.positions.push(frame.payload.globalPositionInt)
    }
    if (frame.payload.missionCount !== undefined) {
      system.missionCount = frame.payload.missionCount.count
    }
    if (frame.payload.missionItemInt !== undefined) {
      system.missionItems.push(frame.payload.missionItemInt)
    }
    systems.set(key, system)
  })

  assert.deepEqual([...systems.keys()].sort(), ['1:1', '2:1'])
  for (const system of systems.values()) {
    assert.ok(system.messageNames.has('HEARTBEAT'))
    assert.ok(system.messageNames.has('ATTITUDE'))
    assert.ok(system.messageNames.has('GLOBAL_POSITION_INT'))
    assert.ok(system.messageNames.has('VFR_HUD'))
    assert.equal(system.positions.length, 1)
  }
  assert.notDeepEqual(systems.get('1:1').positions[0], systems.get('2:1').positions[0])
  assert.equal(systems.get('1:1').missionCount, 3)
  assert.equal(systems.get('1:1').missionItems.length, 3)
  assert.equal(systems.get('2:1').missionCount, 4)
  assert.equal(systems.get('2:1').missionItems.length, 4)
})

test('mixed MAVLink v2 fixture replays to the same normalized envelope stream', () => {
  const first = replayFrames()
  const second = replayFrames()
  assert.ok(first.length > 0)
  assert.deepEqual(second, first)
})
