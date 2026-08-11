import { buildMavlinkV1Frame, computeFrameCrc } from './mavlinkFrame.js'

const UINT8_MAX = 255
const MAVLINK_V1_MAGIC = 0xFE
const MAVLINK_V2_MAGIC = 0xFD

const SUPPORTED_MESSAGE_DECODERS = {
  0: decodeHeartbeat,
  24: decodeGpsRawInt,
  30: decodeAttitude,
  33: decodeGlobalPositionInt,
  42: decodeMissionCurrent,
  44: decodeMissionCount,
  47: decodeMissionAck,
  73: decodeMissionItemInt,
  74: decodeVfrHud,
  242: decodeHomePosition,
}

// Per-message CRC_EXTRA seed from the MAVLink dialect, mixed in after the frame
// bytes so a message whose field layout changed fails the checksum.
const MESSAGE_CRC_EXTRA = {
  0: 50,
  24: 24,
  30: 39,
  33: 104,
  42: 28,
  44: 221,
  47: 153,
  73: 38,
  74: 20,
  242: 104,
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function clampUint8(value, fallback) {
  if (!isNonNegativeInteger(value)) {
    return fallback
  }

  return Math.min(UINT8_MAX, value)
}

function isTelemetryPayload(payload) {
  return payload !== null
    && typeof payload === 'object'
    && isFiniteNumber(payload.timestampMs)
}

function normalizeMessageName(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function maybeObject(value) {
  return value !== null && typeof value === 'object' ? value : null
}

function normalizeEnvelopeCandidate(candidate, nowMs) {
  const envelopeCandidate = maybeObject(candidate)
  if (envelopeCandidate === null) {
    return null
  }

  const messageName = normalizeMessageName(envelopeCandidate.messageName)
  if (messageName === null) {
    return null
  }

  const payload = envelopeCandidate.payload
  if (!isTelemetryPayload(payload)) {
    return null
  }

  // Sequence is a uint8 on the wire and consumers validate it as one, so wrap rather than pass through.
  const sequence = isNonNegativeInteger(envelopeCandidate.sequence)
    ? envelopeCandidate.sequence % 256
    : 0

  const recvTimestampMs = isFiniteNumber(envelopeCandidate.recvTimestampMs)
    ? envelopeCandidate.recvTimestampMs
    : nowMs

  return {
    recvTimestampMs,
    sysId: clampUint8(envelopeCandidate.sysId, 1),
    compId: clampUint8(envelopeCandidate.compId, 1),
    messageName,
    sequence,
    payload,
  }
}

function tryParseJsonEnvelope(rawBuffer, nowMs) {
  let parsed

  try {
    parsed = JSON.parse(rawBuffer.toString('utf8'))
  } catch {
    return null
  }

  return normalizeEnvelopeCandidate(parsed, nowMs)
}

function readFloatLE(payload, offset) {
  return payload.readFloatLE(offset)
}

/**
 * MAVLink 2 (the default for ArduPilot and PX4) trims trailing zero bytes off a
 * payload before transmitting it, so a perfectly valid frame routinely arrives
 * shorter than its documented v1 length — e.g. a MISSION_ITEM_INT whose
 * current/autocontinue are both 0 lands as 35 bytes rather than 37. Rejecting
 * those on a bare length check silently stalls a whole mission pull.
 *
 * Copy the payload into a zero-filled buffer of the documented length instead:
 * the bytes MAVLink 2 removed were zero by definition, so truncated and
 * full-length payloads then decode identically. An empty payload is still
 * rejected — MAVLink 2 never trims below one byte, so that is corrupt input.
 *
 * Only the mission/home decoders use this; the pre-existing telemetry decoders
 * keep their established strict length guards.
 */
function payloadPaddedTo(payload, length) {
  if (payload.length === 0) {
    return null
  }

  if (payload.length >= length) {
    return payload
  }

  const padded = Buffer.alloc(length)
  payload.copy(padded)
  return padded
}

function decodeHeartbeat(frame) {
  return {
    messageName: 'HEARTBEAT',
    payload: {
      timestampMs: frame.recvTimestampMs,
    },
  }
}

function decodeAttitude(frame) {
  if (frame.payload.length < 28) {
    return null
  }

  return {
    messageName: 'ATTITUDE',
    payload: {
      timestampMs: frame.recvTimestampMs,
      attitude: {
        rollRad: readFloatLE(frame.payload, 4),
        pitchRad: readFloatLE(frame.payload, 8),
        yawRad: readFloatLE(frame.payload, 12),
        pitchSpeedRadPerSec: readFloatLE(frame.payload, 20),
        yawSpeedRadPerSec: readFloatLE(frame.payload, 24),
      },
    },
  }
}

function decodeGpsRawInt(frame) {
  if (frame.payload.length < 30) {
    return null
  }

  return {
    messageName: 'GPS_RAW_INT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      gpsRawInt: {
        velCms: frame.payload.readUInt16LE(24),
        cogCdeg: frame.payload.readUInt16LE(26),
      },
    },
  }
}

function decodeGlobalPositionInt(frame) {
  if (frame.payload.length < 28) {
    return null
  }

  return {
    messageName: 'GLOBAL_POSITION_INT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      globalPositionInt: {
        latDegE7: frame.payload.readInt32LE(4),
        lonDegE7: frame.payload.readInt32LE(8),
        altMm: frame.payload.readInt32LE(12),
        relativeAltMm: frame.payload.readInt32LE(16),
        vxCms: frame.payload.readInt16LE(20),
        vyCms: frame.payload.readInt16LE(22),
        vzCms: frame.payload.readInt16LE(24),
        headingCdeg: frame.payload.readUInt16LE(26),
      },
    },
  }
}

function decodeVfrHud(frame) {
  if (frame.payload.length < 20) {
    return null
  }

  return {
    messageName: 'VFR_HUD',
    payload: {
      timestampMs: frame.recvTimestampMs,
      // Wire order is size-sorted, not xml-declaration order: alt@8 and throttle@18 are unused here.
      vfrHud: {
        airSpeedMps: readFloatLE(frame.payload, 0),
        groundSpeedMps: readFloatLE(frame.payload, 4),
        climbMps: readFloatLE(frame.payload, 12),
        headingDeg: frame.payload.readInt16LE(16),
      },
    },
  }
}

function decodeMissionCount(frame) {
  const payload = payloadPaddedTo(frame.payload, 4)
  if (payload === null) {
    return null
  }

  return {
    messageName: 'MISSION_COUNT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionCount: {
        count: payload.readUInt16LE(0),
      },
    },
  }
}

function decodeMissionItemInt(frame) {
  const payload = payloadPaddedTo(frame.payload, 37)
  if (payload === null) {
    return null
  }

  return {
    messageName: 'MISSION_ITEM_INT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      // Wire order is size-sorted: the four floats and two ints come before the
      // seq/command pair, which comes before the single bytes — see the CRC/offset
      // table in this plan's Global Constraints, verified against c_library_v2.
      missionItemInt: {
        seq: payload.readUInt16LE(28),
        command: payload.readUInt16LE(30),
        frameId: payload.readUInt8(34),
        current: payload.readUInt8(35) !== 0,
        autocontinue: payload.readUInt8(36) !== 0,
        param1: readFloatLE(payload, 0),
        param2: readFloatLE(payload, 4),
        param3: readFloatLE(payload, 8),
        param4: readFloatLE(payload, 12),
        latDegE7: payload.readInt32LE(16),
        lonDegE7: payload.readInt32LE(20),
        altM: readFloatLE(payload, 24),
      },
    },
  }
}

function decodeMissionCurrent(frame) {
  const payload = payloadPaddedTo(frame.payload, 2)
  if (payload === null) {
    return null
  }

  return {
    messageName: 'MISSION_CURRENT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionCurrent: {
        seq: payload.readUInt16LE(0),
      },
    },
  }
}

function decodeMissionAck(frame) {
  const payload = payloadPaddedTo(frame.payload, 3)
  if (payload === null) {
    return null
  }

  return {
    messageName: 'MISSION_ACK',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionAck: {
        type: payload.readUInt8(2),
      },
    },
  }
}

function decodeHomePosition(frame) {
  const payload = payloadPaddedTo(frame.payload, 12)
  if (payload === null) {
    return null
  }

  return {
    messageName: 'HOME_POSITION',
    payload: {
      timestampMs: frame.recvTimestampMs,
      homePosition: {
        latDegE7: payload.readInt32LE(0),
        lonDegE7: payload.readInt32LE(4),
        altMm: payload.readInt32LE(8),
      },
    },
  }
}

function decodeSupportedFrame(frame) {
  const decoder = SUPPORTED_MESSAGE_DECODERS[frame.msgId]
  if (decoder === undefined) {
    return null
  }

  const decoded = decoder(frame)
  if (decoded === null) {
    return null
  }

  return {
    recvTimestampMs: frame.recvTimestampMs,
    sysId: frame.sysId,
    compId: frame.compId,
    sequence: frame.sequence,
    ...decoded,
  }
}

export { computeFrameCrc, crcAccumulate } from './mavlinkFrame.js'

function parseMavlinkFrames(rawBuffer, nowMs) {
  const envelopes = []
  let decodeErrors = 0
  let sawFramePrefix = false

  for (let offset = 0; offset < rawBuffer.length;) {
    const magic = rawBuffer[offset]

    if (magic !== MAVLINK_V1_MAGIC && magic !== MAVLINK_V2_MAGIC) {
      offset += 1
      continue
    }

    sawFramePrefix = true
    const payloadLength = rawBuffer[offset + 1]

    if (payloadLength === undefined) {
      decodeErrors += 1
      break
    }

    let frameLength = 0
    let sequenceOffset = 0
    let sysIdOffset = 0
    let compIdOffset = 0
    let payloadOffset = 0
    let msgId = 0

    if (magic === MAVLINK_V1_MAGIC) {
      frameLength = payloadLength + 8
      sequenceOffset = offset + 2
      sysIdOffset = offset + 3
      compIdOffset = offset + 4
      payloadOffset = offset + 6
      msgId = rawBuffer[offset + 5]
    } else {
      const incompatFlags = rawBuffer[offset + 2] ?? 0
      const signatureLength = (incompatFlags & 0x01) === 0x01 ? 13 : 0
      frameLength = payloadLength + 12 + signatureLength
      sequenceOffset = offset + 4
      sysIdOffset = offset + 5
      compIdOffset = offset + 6
      payloadOffset = offset + 10
      msgId = (rawBuffer[offset + 7] ?? 0)
        | ((rawBuffer[offset + 8] ?? 0) << 8)
        | ((rawBuffer[offset + 9] ?? 0) << 16)
    }

    if (offset + frameLength > rawBuffer.length) {
      decodeErrors += 1
      break
    }

    const crcExtra = MESSAGE_CRC_EXTRA[msgId]
    if (crcExtra !== undefined) {
      const expectedCrc = rawBuffer.readUInt16LE(offset + frameLength - 2)
      const actualCrc = computeFrameCrc(rawBuffer, offset + 1, payloadOffset + payloadLength, crcExtra)

      if (expectedCrc !== actualCrc) {
        // A bad checksum means this may not be a real frame header at all, so the
        // length field can't be trusted to find the next one — resync a byte at a time.
        decodeErrors += 1
        offset += 1
        continue
      }
    }

    const frame = {
      recvTimestampMs: nowMs,
      sequence: rawBuffer[sequenceOffset] ?? 0,
      sysId: clampUint8(rawBuffer[sysIdOffset], 1),
      compId: clampUint8(rawBuffer[compIdOffset], 1),
      msgId,
      payload: rawBuffer.subarray(payloadOffset, payloadOffset + payloadLength),
    }

    const envelope = decodeSupportedFrame(frame)
    if (envelope !== null) {
      envelopes.push(envelope)
    }

    offset += frameLength
  }

  if (envelopes.length === 0 && !sawFramePrefix) {
    decodeErrors += 1
  }

  return { envelopes, decodeErrors }
}

/**
 * `nowMs` is injected so a replayed recording decodes to byte-identical envelopes
 * rather than picking up the wall clock of the replay run.
 */
export function parseIncomingDatagram(rawBuffer, nowMs = Date.now()) {
  const jsonEnvelope = tryParseJsonEnvelope(rawBuffer, nowMs)
  if (jsonEnvelope !== null) {
    return { envelopes: [jsonEnvelope], decodeErrors: 0 }
  }

  return parseMavlinkFrames(rawBuffer, nowMs)
}

let mockOutboundSequence = 0

/**
 * Encode a MISSION_COUNT reply — used only by the mission mock (sampleSender.js),
 * which plays the vehicle's side of the handshake this bridge initiates. Not used
 * by the bridge's own runtime, which only ever decodes this message.
 */
export function encodeMissionCount({ sysId, compId, count }) {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(count, 0)
  payload.writeUInt8(sysId, 2)
  payload.writeUInt8(compId, 3)

  mockOutboundSequence = (mockOutboundSequence + 1) % 256
  return buildMavlinkV1Frame(44, payload, { sequence: mockOutboundSequence, sysId, compId, crcExtra: 221 })
}

/** Encode a MISSION_ITEM_INT reply. `item` matches decodeMissionItemInt's payload shape. */
export function encodeMissionItemInt({ sysId, compId, item }) {
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
  payload.writeUInt8(sysId, 32)
  payload.writeUInt8(compId, 33)
  payload.writeUInt8(item.frameId ?? 3, 34)
  payload.writeUInt8(item.current ? 1 : 0, 35)
  payload.writeUInt8(item.autocontinue ? 1 : 0, 36)

  mockOutboundSequence = (mockOutboundSequence + 1) % 256
  return buildMavlinkV1Frame(73, payload, { sequence: mockOutboundSequence, sysId, compId, crcExtra: 38 })
}
