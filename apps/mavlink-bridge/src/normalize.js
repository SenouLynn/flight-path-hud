const UINT8_MAX = 255
const MAVLINK_V1_MAGIC = 0xFE
const MAVLINK_V2_MAGIC = 0xFD

const SUPPORTED_MESSAGE_DECODERS = {
  0: decodeHeartbeat,
  24: decodeGpsRawInt,
  30: decodeAttitude,
  33: decodeGlobalPositionInt,
  74: decodeVfrHud,
}

// Per-message CRC_EXTRA seed from the MAVLink dialect, mixed in after the frame
// bytes so a message whose field layout changed fails the checksum.
const MESSAGE_CRC_EXTRA = {
  0: 50,
  24: 24,
  30: 39,
  33: 104,
  74: 20,
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

function normalizeEnvelopeCandidate(candidate) {
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
    : Date.now()

  return {
    recvTimestampMs,
    sysId: clampUint8(envelopeCandidate.sysId, 1),
    compId: clampUint8(envelopeCandidate.compId, 1),
    messageName,
    sequence,
    payload,
  }
}

function tryParseJsonEnvelope(rawBuffer) {
  let parsed

  try {
    parsed = JSON.parse(rawBuffer.toString('utf8'))
  } catch {
    return null
  }

  return normalizeEnvelopeCandidate(parsed)
}

function readFloatLE(payload, offset) {
  return payload.readFloatLE(offset)
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

function parseMavlinkFrames(rawBuffer) {
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
      recvTimestampMs: Date.now(),
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

export function parseIncomingDatagram(rawBuffer) {
  const jsonEnvelope = tryParseJsonEnvelope(rawBuffer)
  if (jsonEnvelope !== null) {
    return { envelopes: [jsonEnvelope], decodeErrors: 0 }
  }

  return parseMavlinkFrames(rawBuffer)
}
