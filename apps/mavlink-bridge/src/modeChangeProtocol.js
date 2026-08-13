import { buildMavlinkV1Frame } from './mavlinkFrame.js'

export const MAV_CMD_DO_SET_MODE = 176
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1
let sequence = 0

export function encodeModeChange({ sysId, compId, targetSystemId, targetComponentId, customMode }) {
  if (!Number.isInteger(customMode) || customMode < 0 || customMode > 0xffffffff) throw new Error('invalid customMode')
  const payload = Buffer.alloc(33)
  payload.writeFloatLE(MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 0)
  payload.writeFloatLE(customMode, 4)
  payload.writeUInt16LE(MAV_CMD_DO_SET_MODE, 28)
  payload.writeUInt8(targetSystemId, 30)
  payload.writeUInt8(targetComponentId, 31)
  sequence = (sequence + 1) & 0xff
  return buildMavlinkV1Frame(76, payload, { sequence, sysId, compId, crcExtra: 152 })
}
