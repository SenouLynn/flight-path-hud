import { buildMavlinkV1Frame } from './mavlinkFrame.js'

export const MAV_CMD_NAV_LAND = 21
let sequence = 0

/** Exact-target Copter land at the current location; no coordinates are supplied. */
export function encodeGuidedLand({ sysId, compId, targetSystemId, targetComponentId }) {
  const payload = Buffer.alloc(33)
  payload.writeUInt16LE(MAV_CMD_NAV_LAND, 28)
  payload.writeUInt8(targetSystemId, 30)
  payload.writeUInt8(targetComponentId, 31)
  sequence = (sequence + 1) & 0xff
  return buildMavlinkV1Frame(76, payload, { sequence, sysId, compId, crcExtra: 152 })
}
