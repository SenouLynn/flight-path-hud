import { buildMavlinkV1Frame } from './mavlinkFrame.js'

export const MISSION_CLEAR_ALL_MSG_ID = 45
export const MISSION_COUNT_MSG_ID = 44
export const MISSION_ITEM_INT_MSG_ID = 73
export const MAV_MISSION_ACCEPTED = 0

const CRC_EXTRA = new Map([
  [MISSION_CLEAR_ALL_MSG_ID, 232],
  [MISSION_COUNT_MSG_ID, 221],
  [MISSION_ITEM_INT_MSG_ID, 38],
])

let sequence = 0
const nextSequence = () => { sequence = (sequence + 1) & 0xff; return sequence }

function frame(messageId, payload, sysId, compId) {
  return buildMavlinkV1Frame(messageId, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA.get(messageId),
  })
}

export function encodeMissionClearAll({ sysId, compId, targetSystemId, targetComponentId }) {
  const payload = Buffer.alloc(2)
  payload.writeUInt8(targetSystemId, 0)
  payload.writeUInt8(targetComponentId, 1)
  return frame(MISSION_CLEAR_ALL_MSG_ID, payload, sysId, compId)
}

export function encodeMissionUploadCount({ sysId, compId, targetSystemId, targetComponentId, count }) {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(count, 0)
  payload.writeUInt8(targetSystemId, 2)
  payload.writeUInt8(targetComponentId, 3)
  return frame(MISSION_COUNT_MSG_ID, payload, sysId, compId)
}

export function encodeMissionUploadItemInt({ sysId, compId, targetSystemId, targetComponentId, item }) {
  const payload = Buffer.alloc(37)
  payload.writeFloatLE(item.param1 ?? 0, 0)
  payload.writeFloatLE(item.param2 ?? 0, 4)
  payload.writeFloatLE(item.param3 ?? 0, 8)
  payload.writeFloatLE(item.param4 ?? 0, 12)
  payload.writeInt32LE(item.latDegE7, 16)
  payload.writeInt32LE(item.lonDegE7, 20)
  payload.writeFloatLE(item.altM, 24)
  payload.writeUInt16LE(item.seq, 28)
  payload.writeUInt16LE(item.command, 30)
  payload.writeUInt8(targetSystemId, 32)
  payload.writeUInt8(targetComponentId, 33)
  payload.writeUInt8(item.frameId, 34)
  payload.writeUInt8(item.current ? 1 : 0, 35)
  payload.writeUInt8(item.autocontinue ? 1 : 0, 36)
  return frame(MISSION_ITEM_INT_MSG_ID, payload, sysId, compId)
}
