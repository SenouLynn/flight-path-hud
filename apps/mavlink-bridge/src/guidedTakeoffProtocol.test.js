import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { encodeGuidedTakeoff, MAV_CMD_NAV_TAKEOFF } from './guidedTakeoffProtocol.js'

test('encodes an exact-target Copter Guided takeoff COMMAND_LONG', () => {
  const frame = encodeGuidedTakeoff({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, relativeAltitudeM: 12 })
  assert.equal(frame[5], 76); assert.equal(frame.readUInt16LE(6 + 28), MAV_CMD_NAV_TAKEOFF)
  assert.equal(frame.readFloatLE(6 + 24), 12); assert.equal(frame[6 + 30], 1); assert.equal(frame[6 + 31], 1)
  assert.equal(frame.readUInt16LE(frame.length - 2), computeFrameCrc(frame, 1, frame.length - 2, 152))
})

test('bounds relative takeoff altitude', () => {
  const base = { sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 }
  assert.throws(() => encodeGuidedTakeoff({ ...base, relativeAltitudeM: 1 }), /between 2 and 120/)
  assert.throws(() => encodeGuidedTakeoff({ ...base, relativeAltitudeM: 121 }), /between 2 and 120/)
})
