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
  assert.deepEqual(decodeMissionRequest(frame), { messageName: 'MISSION_REQUEST_LIST' })
})

test('decodeMissionRequest round-trips encodeMissionRequestInt, including seq', () => {
  const frame = encodeMissionRequestInt({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, seq: 9 })
  assert.deepEqual(decodeMissionRequest(frame), { messageName: 'MISSION_REQUEST_INT', seq: 9 })
})

test('decodeMissionRequest rejects a corrupted CRC', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  frame[6] ^= 0xFF // flip a payload byte without touching the CRC
  assert.equal(decodeMissionRequest(frame), null)
})
