import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { encodeGuidedReposition, MAV_CMD_DO_REPOSITION, MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_TYPE_FIXED_WING, MAV_TYPE_QUADROTOR } from './guidedRepositionProtocol.js'

function decode(frame) {
  return { messageId: frame[5], speed: frame.readFloatLE(6), flags: frame.readFloatLE(10),
    radius: frame.readFloatLE(14), yaw: frame.readFloatLE(18), latitude: frame.readInt32LE(22),
    longitude: frame.readInt32LE(26), altitude: frame.readFloatLE(30), command: frame.readUInt16LE(34),
    target: [...frame.subarray(36, 38)], coordinateFrame: frame[38], current: frame[39], autocontinue: frame[40] }
}

test('encodes a CRC-correct Copter COMMAND_INT without implicit mode change', () => {
  const frame = encodeGuidedReposition({ sysId: 255, compId: 190, targetSystemId: 1,
    targetComponentId: 1, latitudeDeg: 35.1234567, longitudeDeg: -80.7654321,
    relativeAltitudeM: 25, vehicleType: MAV_TYPE_QUADROTOR })
  const fields = decode(frame)
  assert.deepEqual({ ...fields, yaw: Number.isNaN(fields.yaw) ? 'NaN' : fields.yaw }, {
    messageId: 75, speed: -1, flags: 0, radius: 0, yaw: 'NaN', latitude: 351234567,
    longitude: -807654321, altitude: 25, command: MAV_CMD_DO_REPOSITION,
    target: [1, 1], coordinateFrame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, current: 0, autocontinue: 0 })
  assert.equal(frame.readUInt16LE(frame.length - 2), computeFrameCrc(frame, 1, frame.length - 2, 158))
})

test('Plane encoding requires explicit loiter radius and direction', () => {
  for (const [loiterDirection, yaw] of [['clockwise', 0], ['counterclockwise', 1]]) {
    const frame = encodeGuidedReposition({ sysId: 255, compId: 190, targetSystemId: 2,
      targetComponentId: 1, latitudeDeg: -35, longitudeDeg: 149, relativeAltitudeM: 100,
      vehicleType: MAV_TYPE_FIXED_WING, loiterRadiusM: 75, loiterDirection })
    assert.equal(decode(frame).radius, 75)
    assert.equal(decode(frame).yaw, yaw)
  }
  assert.throws(() => encodeGuidedReposition({ sysId: 255, compId: 190, targetSystemId: 2,
    targetComponentId: 1, latitudeDeg: 0, longitudeDeg: 0, relativeAltitudeM: 10,
    vehicleType: MAV_TYPE_FIXED_WING }), /loiterRadiusM/)
})

test('rejects ambiguous vehicle semantics and invalid coordinates', () => {
  const base = { sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1,
    latitudeDeg: 0, longitudeDeg: 0, relativeAltitudeM: 10, vehicleType: MAV_TYPE_QUADROTOR }
  assert.throws(() => encodeGuidedReposition({ ...base, loiterRadiusM: 50 }), /does not accept/)
  assert.throws(() => encodeGuidedReposition({ ...base, latitudeDeg: 91 }), /latitude/)
  assert.throws(() => encodeGuidedReposition({ ...base, targetSystemId: 0 }), /target id/)
})
