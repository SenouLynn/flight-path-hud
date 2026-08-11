const MAVLINK_V1_MAGIC = 0xFE

/** MAVLink X.25 checksum (CRC-16/MCRF4XX): reflected poly 0x1021, init 0xFFFF. */
export function crcAccumulate(byte, crc) {
  let tmp = byte ^ (crc & 0xFF)
  tmp = (tmp ^ (tmp << 4)) & 0xFF
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
}

/** Checksum over [startOffset, endOffset) — len byte through payload — plus CRC_EXTRA. */
export function computeFrameCrc(buffer, startOffset, endOffset, crcExtra) {
  let crc = 0xFFFF

  for (let index = startOffset; index < endOffset; index += 1) {
    crc = crcAccumulate(buffer[index], crc)
  }

  return crcAccumulate(crcExtra, crc)
}

/**
 * Build one MAVLink v1 frame: magic, len, seq, sysid, compid, msgid, payload, CRC.
 * No MAVLink2, no signing, no extension fields — every message this bridge sends
 * or the mission mock replies with fits in v1 (see mission_overlay_design.md §2).
 */
export function buildMavlinkV1Frame(msgId, payload, { sequence, sysId, compId, crcExtra }) {
  const frame = Buffer.alloc(6 + payload.length + 2)
  frame[0] = MAVLINK_V1_MAGIC
  frame[1] = payload.length
  frame[2] = sequence & 0xFF
  frame[3] = sysId
  frame[4] = compId
  frame[5] = msgId
  payload.copy(frame, 6)

  const crc = computeFrameCrc(frame, 1, 6 + payload.length, crcExtra)
  frame.writeUInt16LE(crc, 6 + payload.length)

  return frame
}
