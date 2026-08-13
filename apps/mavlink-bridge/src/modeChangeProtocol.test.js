import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { encodeModeChange, MAV_CMD_DO_SET_MODE } from './modeChangeProtocol.js'

test('encodes exact-target MAV_CMD_DO_SET_MODE with valid CRC', () => {
  const frame = encodeModeChange({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1, customMode: 12 })
  assert.equal(frame[5], 76)
  assert.equal(frame.readFloatLE(6), 1)
  assert.equal(frame.readFloatLE(10), 12)
  assert.equal(frame.readUInt16LE(34), MAV_CMD_DO_SET_MODE)
  assert.deepEqual([...frame.subarray(36, 38)], [2, 1])
  assert.equal(frame.readUInt16LE(frame.length - 2), computeFrameCrc(frame, 1, frame.length - 2, 152))
})

test('rejects custom modes that cannot be portably encoded', () => {
  assert.throws(() => encodeModeChange({ sysId: 255, compId: 190,
    targetSystemId: 1, targetComponentId: 1, customMode: -1 }), /customMode/)
})
