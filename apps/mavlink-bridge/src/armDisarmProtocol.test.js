import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { encodeArmDisarm, MAV_CMD_COMPONENT_ARM_DISARM } from './armDisarmProtocol.js'

test('encodes standard exact-target arm/disarm and never force magic', () => {
  for (const arm of [true, false]) {
    const frame = encodeArmDisarm({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1, arm })
    assert.equal(frame[5], 76)
    assert.equal(frame.readFloatLE(6), arm ? 1 : 0)
    assert.equal(frame.readFloatLE(10), 0, 'param2 force magic is prohibited')
    assert.equal(frame.readUInt16LE(34), MAV_CMD_COMPONENT_ARM_DISARM)
    assert.deepEqual([...frame.subarray(36, 38)], [2, 1])
    assert.equal(frame.readUInt16LE(frame.length - 2), computeFrameCrc(frame, 1, frame.length - 2, 152))
  }
})

test('rejects ambiguous non-boolean action', () => {
  assert.throws(() => encodeArmDisarm({ sysId: 255, compId: 190,
    targetSystemId: 1, targetComponentId: 1, arm: 1 }), /boolean/)
})
