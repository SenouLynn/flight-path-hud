import assert from 'node:assert/strict'
import test from 'node:test'
import { createBridgeCore } from './bridgeCore.js'

function jsonDatagram(sysId, messageName = 'HEARTBEAT') {
  assert.equal(messageName, 'HEARTBEAT')
  return Buffer.from(JSON.stringify({
    recvTimestampMs: 1000,
    sysId,
    compId: 1,
    messageName,
    sequence: 4,
    payload: { timestampMs: 1000, heartbeat: {
      customMode: 0, vehicleType: 0, autopilotType: 0, baseMode: 0,
      armed: false, systemStatus: 0, mavlinkVersion: 3,
    } },
  }))
}

test('flags one system transmitting from two sources', () => {
  const core = createBridgeCore({ now: () => 1000 })

  core.ingestDatagram(jsonDatagram(1), 1000, '127.0.0.1:5001')
  assert.deepEqual(core.takeSourceConflicts(), [], 'a single source is not a conflict')

  // Same sysId, different endpoint: two transmitters claiming one vehicle.
  core.ingestDatagram(jsonDatagram(1), 1000, '127.0.0.1:5002')
  const conflicts = core.takeSourceConflicts()

  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].system, '1:1')
  assert.deepEqual(conflicts[0].sources, ['127.0.0.1:5001', '127.0.0.1:5002'])
})

test('reports each duplicate source once, not on every packet', () => {
  const core = createBridgeCore({ now: () => 1000 })

  core.ingestDatagram(jsonDatagram(1), 1000, 'a')
  core.ingestDatagram(jsonDatagram(1), 1000, 'b')
  core.takeSourceConflicts()

  core.ingestDatagram(jsonDatagram(1), 1000, 'a')
  core.ingestDatagram(jsonDatagram(1), 1000, 'b')

  assert.deepEqual(core.takeSourceConflicts(), [])
})

test('distinct systems on distinct sources are not a conflict', () => {
  const core = createBridgeCore({ now: () => 1000 })

  core.ingestDatagram(jsonDatagram(1), 1000, '127.0.0.1:5001')
  core.ingestDatagram(jsonDatagram(2), 1000, '127.0.0.1:5002')

  assert.deepEqual(core.takeSourceConflicts(), [])
})

test('forgets a stale system\'s sources, so the map cannot grow unbounded', () => {
  const core = createBridgeCore({ systemTtlMs: 5000, now: () => 0 })

  core.ingestDatagram(jsonDatagram(1), 1000, 'a')
  core.ingestDatagram(jsonDatagram(1), 1000, 'b')
  core.takeSourceConflicts()

  core.tick(9000)
  assert.equal(core.systemCount(), 0)

  // Same system reappearing from the same two sources is a fresh conflict, which
  // only holds if the previous source set was dropped with the system.
  core.ingestDatagram(jsonDatagram(1), 9000, 'a')
  core.ingestDatagram(jsonDatagram(1), 9000, 'b')
  assert.equal(core.takeSourceConflicts().length, 1)
})

test('evicts a system that stops transmitting', () => {
  const core = createBridgeCore({ systemTtlMs: 5000, now: () => 0 })

  core.ingestDatagram(jsonDatagram(9), 1000)
  assert.equal(core.systemCount(), 1)

  core.tick(4000)
  assert.equal(core.systemCount(), 1, 'still fresh inside the TTL')

  core.tick(9000)
  assert.equal(core.systemCount(), 0, 'evicted once the TTL lapses')
})
