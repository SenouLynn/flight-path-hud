import { buildMavlinkV1Frame, computeFrameCrc } from './mavlinkFrame.js'

const MAVLINK_V1_MAGIC = 0xFE

export const MISSION_REQUEST_LIST_MSG_ID = 43
export const MISSION_REQUEST_INT_MSG_ID = 51
export const MISSION_ACK_MSG_ID = 47

// CRC_EXTRA for the three messages this module builds, verified against
// mavlink/c_library_v2's generated headers. Kept local rather than shared with
// normalize.js's table — the two modules deliberately own disjoint message sets
// (see docs/mission_overlay_design.md §2), MISSION_ACK aside, which appears in
// both because the vehicle can send it (normalize.js decodes that) and the bridge
// can send it (this file encodes that) — the same message ID, two directions.
const CRC_EXTRA = {
  [MISSION_REQUEST_LIST_MSG_ID]: 132,
  [MISSION_REQUEST_INT_MSG_ID]: 196,
  [MISSION_ACK_MSG_ID]: 153,
}

export const MAV_MISSION_ACCEPTED = 0

let outboundSequence = 0

function nextSequence() {
  outboundSequence = (outboundSequence + 1) % 256
  return outboundSequence
}

/**
 * MISSION_REQUEST_LIST(43): opens the pull. `sysId`/`compId` are this bridge's own
 * identity for the frame header; `targetSystemId`/`targetComponentId` address the
 * vehicle being asked.
 */
export function encodeMissionRequestList({ sysId, compId, targetSystemId, targetComponentId }) {
  const payload = Buffer.alloc(2)
  payload.writeUInt8(targetSystemId, 0)
  payload.writeUInt8(targetComponentId, 1)
  return buildMavlinkV1Frame(MISSION_REQUEST_LIST_MSG_ID, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA[MISSION_REQUEST_LIST_MSG_ID],
  })
}

/** MISSION_REQUEST_INT(51): pulls one item by index. */
export function encodeMissionRequestInt({ sysId, compId, targetSystemId, targetComponentId, seq }) {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(seq, 0)
  payload.writeUInt8(targetSystemId, 2)
  payload.writeUInt8(targetComponentId, 3)
  return buildMavlinkV1Frame(MISSION_REQUEST_INT_MSG_ID, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA[MISSION_REQUEST_INT_MSG_ID],
  })
}

/**
 * MISSION_ACK(47): closes a successful pull. This bridge only ever sends
 * MAV_MISSION_ACCEPTED — an error ack is something the *vehicle* sends
 * (decoded in normalize.js), never something this bridge originates, since the
 * bridge never rejects a mission it merely reads.
 */
export function encodeMissionAck({ sysId, compId, targetSystemId, targetComponentId, type = MAV_MISSION_ACCEPTED }) {
  const payload = Buffer.alloc(3)
  payload.writeUInt8(targetSystemId, 0)
  payload.writeUInt8(targetComponentId, 1)
  payload.writeUInt8(type, 2)
  return buildMavlinkV1Frame(MISSION_ACK_MSG_ID, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA[MISSION_ACK_MSG_ID],
  })
}

/**
 * Decode a MISSION_REQUEST_LIST or MISSION_REQUEST_INT v1 frame — the reverse of
 * this module's own encoders, used only by the mission mock responder
 * (sampleSender.js), which plays the vehicle's side of the handshake and needs to
 * read back what the bridge just sent it. Deliberately scoped to exactly these two
 * message IDs and to one frame per datagram (unlike normalize.js's general
 * multi-frame parser), since that is all the bridge ever sends per call.
 */
export function decodeMissionRequest(datagram) {
  if (datagram.length < 8 || datagram[0] !== MAVLINK_V1_MAGIC) {
    return null
  }

  const payloadLength = datagram[1]
  const msgId = datagram[5]
  const frameLength = payloadLength + 8

  if (datagram.length < frameLength || CRC_EXTRA[msgId] === undefined) {
    return null
  }

  const expectedCrc = datagram.readUInt16LE(frameLength - 2)
  const actualCrc = computeFrameCrc(datagram, 1, 6 + payloadLength, CRC_EXTRA[msgId])
  if (expectedCrc !== actualCrc) {
    return null
  }

  const payload = datagram.subarray(6, 6 + payloadLength)

  if (msgId === MISSION_REQUEST_LIST_MSG_ID) {
    return { messageName: 'MISSION_REQUEST_LIST' }
  }

  if (msgId === MISSION_REQUEST_INT_MSG_ID && payload.length >= 4) {
    return { messageName: 'MISSION_REQUEST_INT', seq: payload.readUInt16LE(0) }
  }

  return null
}
