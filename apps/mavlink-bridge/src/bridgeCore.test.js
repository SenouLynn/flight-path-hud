import assert from 'node:assert/strict'
import test from 'node:test'
import { createBridgeCore } from './bridgeCore.js'

function jsonDatagram(sysId, messageName = 'HEARTBEAT', sequence = 4) {
  assert.equal(messageName, 'HEARTBEAT')
  return Buffer.from(JSON.stringify({
    recvTimestampMs: 1000,
    sysId,
    compId: 1,
    messageName,
    sequence,
    payload: { timestampMs: 1000, heartbeat: {
      customMode: 0, vehicleType: 0, autopilotType: 0, baseMode: 0,
      armed: false, systemStatus: 0, mavlinkVersion: 3,
    } },
  }))
}

function normalizedDatagram(messageName, section, values, sequence = 4) {
  return Buffer.from(JSON.stringify({
    recvTimestampMs: 1000, sysId: 1, compId: 1, messageName, sequence,
    payload: { timestampMs: 1000, [section]: values },
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

test('wraps fallback sequence per core and sorts rates by count then name', () => {
  const core = createBridgeCore({ now: () => 1000 })
  let output
  for (let index = 0; index < 257; index += 1) output = core.ingestDatagram(jsonDatagram(1, 'HEARTBEAT', 0), 1000)
  assert.equal(output[0].sequence, 1)
  core.ingestDatagram(normalizedDatagram('ATTITUDE', 'attitude', {
    rollRad: 0, pitchRad: 0, yawRad: 0, pitchSpeedRadPerSec: 0, yawSpeedRadPerSec: 0,
  }), 1000)
  core.ingestDatagram(normalizedDatagram('VFR_HUD', 'vfrHud', {
    airSpeedMps: 0, groundSpeedMps: 0, climbMps: 0, headingDeg: 0,
  }), 1000)
  core.tick(2000)
  const health = core.ingestDatagram(jsonDatagram(1), 2001)[0].health
  assert.deepEqual(health.messageRates, [
    { messageName: 'HEARTBEAT', rateHz: 257 },
    { messageName: 'ATTITUDE', rateHz: 1 },
    { messageName: 'VFR_HUD', rateHz: 1 },
  ])
})
