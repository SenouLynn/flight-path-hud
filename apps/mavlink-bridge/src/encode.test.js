import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import {
  MAV_MISSION_ACCEPTED,
  decodeMissionRequest,
  encodeMissionAck,
  encodeMissionRequestInt,
  encodeMissionRequestList,
} from './encode.js'

test('encodeMissionRequestList produces a CRC-correct v1 frame addressing the target', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })

  assert.equal(frame[0], 0xFE)
  assert.equal(frame[1], 2) // payload length
  assert.equal(frame[3], 255) // sender sysId
  assert.equal(frame[4], 190) // sender compId
  assert.equal(frame[5], 43) // MISSION_REQUEST_LIST
  assert.equal(frame.readUInt8(6), 1) // target_system
  assert.equal(frame.readUInt8(7), 1) // target_component

  const expectedCrc = computeFrameCrc(frame, 1, 8, 132)
  assert.equal(frame.readUInt16LE(8), expectedCrc)
})

test('encodeMissionRequestInt carries the requested seq', () => {
  const frame = encodeMissionRequestInt({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, seq: 5 })
  const payload = frame.subarray(6, 10)
  assert.equal(payload.readUInt16LE(0), 5)
  assert.equal(payload.readUInt8(2), 1)
  assert.equal(payload.readUInt8(3), 1)

  const expectedCrc = computeFrameCrc(frame, 1, 10, 196)
  assert.equal(frame.readUInt16LE(10), expectedCrc)
})

test('encodeMissionAck defaults to MAV_MISSION_ACCEPTED', () => {
  const frame = encodeMissionAck({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  assert.equal(frame.readUInt8(8), MAV_MISSION_ACCEPTED)
})

test('decodeMissionRequest round-trips encodeMissionRequestList', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  assert.deepEqual(decodeMissionRequest(frame), {
    messageName: 'MISSION_REQUEST_LIST',
    targetSystem: 1,
    targetComponent: 1,
  })
})

test('decodeMissionRequest round-trips encodeMissionRequestInt, including seq', () => {
  const frame = encodeMissionRequestInt({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, seq: 9 })
  assert.deepEqual(decodeMissionRequest(frame), {
    messageName: 'MISSION_REQUEST_INT',
    seq: 9,
    targetSystem: 1,
    targetComponent: 1,
  })
})

/*
 * The offsets differ between the two messages, and getting them wrong is silent:
 * a request for vehicle 2 that decodes as vehicle 1 still looks like a valid
 * frame. Distinct values everywhere so a transposed read cannot pass.
 */
test('decodeMissionRequest reads the target of a non-default system', () => {
  const list = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 7 })
  assert.deepEqual(decodeMissionRequest(list), {
    messageName: 'MISSION_REQUEST_LIST',
    targetSystem: 2,
    targetComponent: 7,
  })

  const int = encodeMissionRequestInt({ sysId: 255, compId: 190, targetSystemId: 3, targetComponentId: 5, seq: 260 })
  assert.deepEqual(decodeMissionRequest(int), {
    messageName: 'MISSION_REQUEST_INT',
    // 260 > 255: proves seq is read as a uint16 and has not been confused with
    // the single-byte target fields that follow it.
    seq: 260,
    targetSystem: 3,
    targetComponent: 5,
  })
})

/* 0 is MAVLink broadcast, not "absent" — it has to survive decoding as a real value. */
test('decodeMissionRequest preserves a broadcast target of 0', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 0, targetComponentId: 0 })
  assert.deepEqual(decodeMissionRequest(frame), {
    messageName: 'MISSION_REQUEST_LIST',
    targetSystem: 0,
    targetComponent: 0,
  })
})

test('decodeMissionRequest rejects a corrupted CRC', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  frame[6] ^= 0xFF // flip a payload byte without touching the CRC
  assert.equal(decodeMissionRequest(frame), null)
})
