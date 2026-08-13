import { buildMavlinkV1Frame } from './mavlinkFrame.js'

export const MAV_CMD_COMPONENT_ARM_DISARM = 400
let sequence = 0

/** Standard arm/disarm only. param2 stays zero: force-arm/disarm magic is prohibited. */
export function encodeArmDisarm({ sysId, compId, targetSystemId, targetComponentId, arm }) {
  if (typeof arm !== 'boolean') throw new Error('arm must be boolean')
  const payload = Buffer.alloc(33)
  payload.writeFloatLE(arm ? 1 : 0, 0)
  payload.writeFloatLE(0, 4)
  payload.writeUInt16LE(MAV_CMD_COMPONENT_ARM_DISARM, 28)
  payload.writeUInt8(targetSystemId, 30)
  payload.writeUInt8(targetComponentId, 31)
  sequence = (sequence + 1) & 0xff
  return buildMavlinkV1Frame(76, payload, { sequence, sysId, compId, crcExtra: 152 })
}
