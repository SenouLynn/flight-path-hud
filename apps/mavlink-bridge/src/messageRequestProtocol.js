import { buildMavlinkV1Frame } from './mavlinkFrame.js'
export const MAV_CMD_REQUEST_MESSAGE = 512
let sequence = 0
export function encodeMessageRequest({ sysId, compId, targetSystemId, targetComponentId, messageId }) {
  if (!Number.isInteger(messageId) || messageId < 0 || messageId > 0xFFFFFF) throw new Error('invalid messageId')
  const payload = Buffer.alloc(33)
  payload.writeFloatLE(messageId, 0)
  payload.writeUInt16LE(MAV_CMD_REQUEST_MESSAGE, 28)
  payload.writeUInt8(targetSystemId, 30); payload.writeUInt8(targetComponentId, 31)
  sequence = (sequence + 1) & 255
  return buildMavlinkV1Frame(76, payload, { sequence, sysId, compId, crcExtra: 152 })
}
