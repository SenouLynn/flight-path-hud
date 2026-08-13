import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { encodeGuidedLand, MAV_CMD_NAV_LAND } from './guidedLandProtocol.js'

test('encodes exact-target land-at-current-location COMMAND_LONG', () => {
  const frame = encodeGuidedLand({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  assert.equal(frame.readUInt16LE(34), MAV_CMD_NAV_LAND)
  assert.deepEqual([...frame.subarray(36, 38)], [1, 1])
  assert.equal(frame.readUInt16LE(frame.length - 2), computeFrameCrc(frame, 1, frame.length - 2, 152))
})
