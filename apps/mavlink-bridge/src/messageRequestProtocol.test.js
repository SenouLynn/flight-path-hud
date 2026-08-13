import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { encodeMessageRequest, MAV_CMD_REQUEST_MESSAGE } from './messageRequestProtocol.js'

test('encodes a CRC-correct target-explicit COMMAND_LONG request', () => {
  const frame = encodeMessageRequest({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1, messageId: 242 })
  assert.equal(frame[5], 76)
  assert.equal(frame.subarray(6).readFloatLE(0), 242)
  assert.equal(frame.subarray(6).readUInt16LE(28), MAV_CMD_REQUEST_MESSAGE)
  assert.deepEqual([...frame.subarray(36, 38)], [2, 1])
  assert.equal(frame.readUInt16LE(39), computeFrameCrc(frame, 1, 39, 152))
})

test('rejects message identifiers outside MAVLink 2 range', () => {
  const base = { sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 }
  assert.throws(() => encodeMessageRequest({ ...base, messageId: -1 }), /messageId/)
  assert.throws(() => encodeMessageRequest({ ...base, messageId: 0x1000000 }), /messageId/)
})
