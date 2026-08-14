import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc, crcAccumulate, parseIncomingDatagram, encodeMissionCount, encodeMissionItemInt } from './normalize.js'

const CRC_EXTRA = { 0: 50, 22: 220, 24: 24, 30: 39, 33: 104, 42: 28, 44: 221, 47: 153, 49: 39, 73: 38, 74: 20, 77: 143, 242: 104 }

function buildMavlinkV1Frame(messageId, payload, { sequence = 7, sysId = 1, compId = 1, corruptCrc = false } = {}) {
  const frame = Buffer.alloc(6 + payload.length + 2)
  frame[0] = 0xFE
  frame[1] = payload.length
  frame[2] = sequence
  frame[3] = sysId
  frame[4] = compId
  frame[5] = messageId
  payload.copy(frame, 6)

  const crcExtra = CRC_EXTRA[messageId]
  const crc = crcExtra === undefined ? 0 : computeFrameCrc(frame, 1, 6 + payload.length, crcExtra)
  frame.writeUInt16LE(corruptCrc ? crc ^ 0xFFFF : crc, 6 + payload.length)

  return frame
}

/**
 * MAVLink 2 framing, used here because only v2 performs the trailing-zero
 * payload trimming the truncation tests below depend on.
 */
function buildMavlinkV2Frame(messageId, payload, { sequence = 7, sysId = 1, compId = 1, signed = false } = {}) {
  const signatureLength = signed ? 13 : 0
  const frame = Buffer.alloc(10 + payload.length + 2 + signatureLength)
  frame[0] = 0xFD
  frame[1] = payload.length
  frame[2] = signed ? 1 : 0
  frame[3] = 0 // compat flags
  frame[4] = sequence
  frame[5] = sysId
  frame[6] = compId
  frame[7] = messageId & 0xFF
  frame[8] = (messageId >> 8) & 0xFF
  frame[9] = (messageId >> 16) & 0xFF
  payload.copy(frame, 10)

  const crcExtra = CRC_EXTRA[messageId]
  const crc = crcExtra === undefined ? 0 : computeFrameCrc(frame, 1, 10 + payload.length, crcExtra)
  frame.writeUInt16LE(crc, 10 + payload.length)
  if (signed) frame.fill(0xA5, 12 + payload.length)

  return frame
}

test('CRC matches the published CRC-16/MCRF4XX check vector', () => {
  // Pins the checksum primitive to the spec rather than to our own frame builder.
  let crc = 0xFFFF
  for (const byte of Buffer.from('123456789')) {
    crc = crcAccumulate(byte, crc)
  }
  assert.equal(crc, 0x6F91)
})

test('rejects MAVLink frames with a bad checksum', () => {
  const payload = Buffer.alloc(28)
  payload.writeFloatLE(0.1, 4)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(30, payload, { corruptCrc: true }))
  assert.equal(result.envelopes.length, 0)
  assert.equal(result.decodeErrors, 1)
})

test('rejects a CRC-valid supported frame with non-finite normalized fields once', () => {
  const payload = Buffer.alloc(28)
  payload.writeFloatLE(Number.NaN, 4)
  const result = parseIncomingDatagram(buildMavlinkV1Frame(30, payload), 1234)
  assert.deepEqual(result, { envelopes: [], decodeErrors: 1 })
})

test('parses JSON envelope datagrams', () => {
  const datagram = Buffer.from(JSON.stringify({
    recvTimestampMs: 10,
    sysId: 1,
    compId: 1,
    messageName: 'VFR_HUD',
    sequence: 9,
    payload: {
      timestampMs: 10,
      vfrHud: {
        headingDeg: 120,
        airSpeedMps: 12.5,
        groundSpeedMps: 11.5,
        climbMps: -0.25,
      },
    },
  }))

  const result = parseIncomingDatagram(datagram)
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 1)
  assert.equal(result.envelopes[0].messageName, 'VFR_HUD')
})

test('rejects oversized JSON sequence numbers instead of rewriting input', () => {
  const datagram = Buffer.from(JSON.stringify({
    recvTimestampMs: 10,
    sysId: 1,
    compId: 1,
    messageName: 'HEARTBEAT',
    sequence: 259,
    payload: { timestampMs: 10, heartbeat: {
      customMode: 0, vehicleType: 0, autopilotType: 0, baseMode: 0,
      armed: false, systemStatus: 0, mavlinkVersion: 3,
    } },
  }))

  const result = parseIncomingDatagram(datagram)
  assert.deepEqual(result, { envelopes: [], decodeErrors: 1 })
})

test('parses MAVLink v1 ATTITUDE frames', () => {
  const payload = Buffer.alloc(28)
  payload.writeUInt32LE(1234, 0)
  payload.writeFloatLE(0.1, 4)
  payload.writeFloatLE(-0.2, 8)
  payload.writeFloatLE(0.3, 12)
  payload.writeFloatLE(0.4, 16)
  payload.writeFloatLE(-0.5, 20)
  payload.writeFloatLE(0.6, 24)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(30, payload))
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 1)
  assert.equal(result.envelopes[0].messageName, 'ATTITUDE')
  assert.equal(result.envelopes[0].payload.attitude.rollRad.toFixed(3), '0.100')
  assert.equal(result.envelopes[0].payload.attitude.pitchRad.toFixed(3), '-0.200')
  assert.equal(result.envelopes[0].payload.attitude.yawSpeedRadPerSec.toFixed(3), '0.600')
})

test('parses portable HEARTBEAT armed, mode, vehicle, and system state', () => {
  const payload = Buffer.alloc(9)
  payload.writeUInt32LE(17, 0)
  payload.writeUInt8(2, 4) // MAV_TYPE_QUADROTOR
  payload.writeUInt8(3, 5) // MAV_AUTOPILOT_ARDUPILOTMEGA
  payload.writeUInt8(0x81, 6) // custom mode enabled + safety armed
  payload.writeUInt8(4, 7) // MAV_STATE_ACTIVE
  payload.writeUInt8(3, 8)
  const result = parseIncomingDatagram(buildMavlinkV1Frame(0, payload))
  assert.deepEqual(result.envelopes[0].payload.heartbeat, {
    customMode: 17, vehicleType: 2, autopilotType: 3, baseMode: 0x81,
    armed: true, systemStatus: 4, mavlinkVersion: 3,
  })
})

test('parses PARAM_VALUE including its portable numeric type id', () => {
  const payload = Buffer.alloc(25)
  payload.writeFloatLE(42.5, 0)
  payload.writeUInt16LE(1200, 4)
  payload.writeUInt16LE(17, 6)
  Buffer.from('WPNAV_SPEED').copy(payload, 8)
  payload.writeUInt8(9, 24)
  const result = parseIncomingDatagram(buildMavlinkV1Frame(22, payload, { sysId: 2 }))
  assert.deepEqual(result.envelopes[0].payload.paramValue, {
    value: 42.5, paramCount: 1200, paramIndex: 17, paramId: 'WPNAV_SPEED', paramType: 9,
  })
})

test('parses multiple MAVLink frames from one datagram and ignores unsupported messages', () => {
  const heartbeatPayload = Buffer.alloc(9)
  const vfrPayload = Buffer.alloc(20)
  vfrPayload.writeFloatLE(22.5, 0)
  vfrPayload.writeFloatLE(20.25, 4)
  vfrPayload.writeFloatLE(120, 8)
  vfrPayload.writeFloatLE(1.75, 12)
  vfrPayload.writeInt16LE(165, 16)
  vfrPayload.writeUInt16LE(50, 18)
  const unsupportedPayload = Buffer.alloc(2)

  const datagram = Buffer.concat([
    buildMavlinkV1Frame(0, heartbeatPayload),
    buildMavlinkV1Frame(74, vfrPayload),
    buildMavlinkV1Frame(250, unsupportedPayload),
  ])

  const result = parseIncomingDatagram(datagram)
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 2)
  assert.equal(result.envelopes[0].messageName, 'HEARTBEAT')
  assert.equal(result.envelopes[1].messageName, 'VFR_HUD')
  assert.equal(result.envelopes[1].payload.vfrHud.headingDeg, 165)
  assert.equal(result.envelopes[1].payload.vfrHud.airSpeedMps.toFixed(2), '22.50')
  assert.equal(result.envelopes[1].payload.vfrHud.groundSpeedMps.toFixed(2), '20.25')
  assert.equal(result.envelopes[1].payload.vfrHud.climbMps.toFixed(2), '1.75')
})

test('parses MISSION_COUNT', () => {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(3, 0)
  payload.writeUInt8(1, 2)
  payload.writeUInt8(1, 3)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(44, payload))
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes[0].messageName, 'MISSION_COUNT')
  assert.equal(result.envelopes[0].payload.missionCount.count, 3)
})

test('parses MISSION_ITEM_INT', () => {
  const payload = Buffer.alloc(37)
  payload.writeFloatLE(0, 0)
  payload.writeFloatLE(0, 4)
  payload.writeFloatLE(0, 8)
  payload.writeFloatLE(0, 12)
  payload.writeInt32LE(473977420, 16)
  payload.writeInt32LE(85455940, 20)
  payload.writeFloatLE(120.5, 24)
  payload.writeUInt16LE(2, 28)
  payload.writeUInt16LE(16, 30) // MAV_CMD_WAYPOINT
  payload.writeUInt8(1, 32)
  payload.writeUInt8(1, 33)
  payload.writeUInt8(3, 34) // MAV_FRAME_GLOBAL_RELATIVE_ALT
  payload.writeUInt8(1, 35)
  payload.writeUInt8(1, 36)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(73, payload))
  assert.equal(result.decodeErrors, 0)
  const item = result.envelopes[0].payload.missionItemInt
  assert.equal(item.seq, 2)
  assert.equal(item.command, 16)
  assert.equal(item.current, true)
  assert.equal(item.autocontinue, true)
  assert.equal(item.latDegE7, 473977420)
  assert.equal(item.lonDegE7, 85455940)
  assert.equal(item.altM.toFixed(1), '120.5')
})

test('parses MISSION_CURRENT', () => {
  const payload = Buffer.alloc(2)
  payload.writeUInt16LE(5, 0)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(42, payload))
  assert.equal(result.envelopes[0].payload.missionCurrent.seq, 5)
})

test('parses MISSION_ACK', () => {
  const payload = Buffer.alloc(3)
  payload.writeUInt8(1, 0)
  payload.writeUInt8(1, 1)
  payload.writeUInt8(13, 2) // MAV_MISSION_INVALID_SEQUENCE

  const result = parseIncomingDatagram(buildMavlinkV1Frame(47, payload))
  assert.equal(result.envelopes[0].payload.missionAck.type, 13)
})

test('parses COMMAND_ACK for command lifecycle correlation', () => {
  const payload = Buffer.alloc(3)
  payload.writeUInt16LE(400, 0)
  payload.writeUInt8(3, 2)
  const result = parseIncomingDatagram(buildMavlinkV1Frame(77, payload, { sysId: 2, compId: 1 }))
  assert.equal(result.envelopes[0].messageName, 'COMMAND_ACK')
  assert.deepEqual(result.envelopes[0].payload.commandAck, { command: 400, result: 3 })
})

test('parses HOME_POSITION', () => {
  const payload = Buffer.alloc(52)
  payload.writeInt32LE(473977420, 0)
  payload.writeInt32LE(85455940, 4)
  payload.writeInt32LE(500000, 8)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(242, payload))
  const home = result.envelopes[0].payload.homePosition
  assert.equal(home.latDegE7, 473977420)
  assert.equal(home.lonDegE7, 85455940)
  assert.equal(home.altMm, 500000)
})

test('parses GPS_GLOBAL_ORIGIN independently from home', () => {
  const payload = Buffer.alloc(12)
  payload.writeInt32LE(-353632610, 0); payload.writeInt32LE(1491652300, 4); payload.writeInt32LE(584000, 8)
  const origin = parseIncomingDatagram(buildMavlinkV1Frame(49, payload)).envelopes[0].payload.gpsGlobalOrigin
  assert.deepEqual(origin, { latDegE7:-353632610, lonDegE7:1491652300, altMm:584000 })
})

test('decodes a MAVLink 2 MISSION_ITEM_INT whose trailing zero bytes were trimmed off the wire', () => {
  // Real ArduPilot/PX4 traffic: current=0 and autocontinue=0 are the last two
  // bytes, so v2 sends 35 bytes rather than the documented 37. A strict length
  // guard dropped these silently and stalled the whole mission pull.
  const full = Buffer.alloc(37)
  full.writeInt32LE(473977420, 16)
  full.writeInt32LE(85455940, 20)
  full.writeFloatLE(120.5, 24)
  full.writeUInt16LE(2, 28)
  full.writeUInt16LE(16, 30) // MAV_CMD_WAYPOINT
  full.writeUInt8(3, 34) // MAV_FRAME_GLOBAL_RELATIVE_ALT
  // Offsets 35 (current) and 36 (autocontinue) stay 0 and are what v2 trims.
  const trimmed = full.subarray(0, 35)

  const result = parseIncomingDatagram(buildMavlinkV2Frame(73, trimmed))
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 1)

  const item = result.envelopes[0].payload.missionItemInt
  assert.equal(item.seq, 2)
  assert.equal(item.command, 16)
  assert.equal(item.frameId, 3)
  assert.equal(item.current, false, 'implied by the trimmed zero byte')
  assert.equal(item.autocontinue, false, 'implied by the trimmed zero byte')
  assert.equal(item.latDegE7, 473977420)
  assert.equal(item.lonDegE7, 85455940)
  assert.equal(item.altM.toFixed(1), '120.5')
})

test('decodes a MAVLink 2 MISSION_CURRENT trimmed down to a single byte', () => {
  // seq 0 is entirely zero bytes, so v2 trims the 2-byte payload to 1.
  const result = parseIncomingDatagram(buildMavlinkV2Frame(42, Buffer.alloc(1)))

  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes[0].messageName, 'MISSION_CURRENT')
  assert.equal(result.envelopes[0].payload.missionCurrent.seq, 0)
})

test('decodes a MAVLink 2 MISSION_COUNT and HOME_POSITION with trimmed trailing zeroes', () => {
  const count = parseIncomingDatagram(buildMavlinkV2Frame(44, Buffer.from([3])))
  assert.equal(count.envelopes[0].payload.missionCount.count, 3)

  const home = Buffer.alloc(12)
  home.writeInt32LE(473977420, 0)
  home.writeInt32LE(85455940, 4)
  // altMm 0 (sea level) is the trimmed tail.
  const homeResult = parseIncomingDatagram(buildMavlinkV2Frame(242, home.subarray(0, 8)))
  assert.equal(homeResult.envelopes[0].payload.homePosition.latDegE7, 473977420)
  assert.equal(homeResult.envelopes[0].payload.homePosition.altMm, 0)
})

test('a zero-length mission payload is still rejected — MAVLink 2 never trims below one byte', () => {
  const result = parseIncomingDatagram(buildMavlinkV2Frame(73, Buffer.alloc(0)))
  assert.equal(result.envelopes.length, 0)
  assert.equal(result.decodeErrors, 1)
})

test('enforces exact v1 minimum lengths and v2 one-through-maximum lengths', () => {
  for (const payload of [Buffer.alloc(27), Buffer.alloc(29)]) {
    const result = parseIncomingDatagram(buildMavlinkV1Frame(30, payload))
    assert.equal(result.envelopes.length, 0)
    assert.equal(result.decodeErrors, 1)
  }
  const oversizedV2 = parseIncomingDatagram(buildMavlinkV2Frame(30, Buffer.alloc(29)))
  assert.equal(oversizedV2.envelopes.length, 0)
  assert.equal(oversizedV2.decodeErrors, 1)

  const commandWithExtensions = Buffer.alloc(10)
  commandWithExtensions.writeUInt16LE(400, 0)
  const acceptedV2 = parseIncomingDatagram(buildMavlinkV2Frame(77, commandWithExtensions))
  assert.equal(acceptedV2.decodeErrors, 0)
  assert.equal(acceptedV2.envelopes[0].payload.commandAck.command, 400)
})

test('rejects one complete signed-v2 candidate exactly once', () => {
  const result = parseIncomingDatagram(buildMavlinkV2Frame(30, Buffer.alloc(28), { signed: true }))
  assert.equal(result.envelopes.length, 0)
  assert.equal(result.decodeErrors, 1)
})

test('incomplete candidates and noise-only datagrams count once', () => {
  assert.deepEqual(parseIncomingDatagram(Buffer.from([0xFD, 28, 0])), { envelopes: [], decodeErrors: 1 })
  assert.deepEqual(parseIncomingDatagram(Buffer.from('not a frame')), { envelopes: [], decodeErrors: 1 })
})

test('noise before a valid frame is skipped and unsupported complete frames are ignored', () => {
  const attitude = Buffer.alloc(28)
  const withNoise = parseIncomingDatagram(Buffer.concat([Buffer.from([1, 2, 3]), buildMavlinkV1Frame(30, attitude)]))
  assert.equal(withNoise.decodeErrors, 0)
  assert.equal(withNoise.envelopes.length, 1)

  const unsupported = parseIncomingDatagram(buildMavlinkV1Frame(250, Buffer.alloc(2)))
  assert.equal(unsupported.decodeErrors, 0)
  assert.deepEqual(unsupported.envelopes, [])
})

test('encodeMissionCount round-trips through this file\'s own decoder', () => {
  const frame = encodeMissionCount({ sysId: 1, compId: 1, count: 3 })
  const result = parseIncomingDatagram(frame)
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes[0].payload.missionCount.count, 3)
})

test('encodeMissionItemInt round-trips through this file\'s own decoder', () => {
  const item = {
    seq: 1, command: 16, current: false, autocontinue: true,
    latDegE7: 473977420, lonDegE7: 85455940, altM: 100, frameId: 3,
  }
  const frame = encodeMissionItemInt({ sysId: 1, compId: 1, item })
  const result = parseIncomingDatagram(frame)
  const decoded = result.envelopes[0].payload.missionItemInt
  assert.equal(decoded.seq, 1)
  assert.equal(decoded.current, false)
  assert.equal(decoded.autocontinue, true)
  assert.equal(decoded.latDegE7, 473977420)
})
