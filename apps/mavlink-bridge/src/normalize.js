import { buildMavlinkV1Frame, computeFrameCrc } from './mavlinkFrame.js'

const UINT8_MAX = 255
const MAVLINK_V1_MAGIC = 0xFE
const MAVLINK_V2_MAGIC = 0xFD

// common.xml wire metadata. MAVLink 1 carries exactly minLength bytes; MAVLink 2
// may trim trailing zero bytes down to one and may carry extension fields through
// maxLength. Keeping these values beside the decoder makes length policy explicit.
const MESSAGE_DEFINITIONS = {
  0: { decoder: decodeHeartbeat, crcExtra: 50, minLength: 9, maxLength: 9 },
  22: { decoder: decodeParamValue, crcExtra: 220, minLength: 25, maxLength: 25 },
  24: { decoder: decodeGpsRawInt, crcExtra: 24, minLength: 30, maxLength: 52 },
  30: { decoder: decodeAttitude, crcExtra: 39, minLength: 28, maxLength: 28 },
  33: { decoder: decodeGlobalPositionInt, crcExtra: 104, minLength: 28, maxLength: 28 },
  40: { decoder: decodeMissionRequest, crcExtra: 230, minLength: 4, maxLength: 5 },
  42: { decoder: decodeMissionCurrent, crcExtra: 28, minLength: 2, maxLength: 18 },
  44: { decoder: decodeMissionCount, crcExtra: 221, minLength: 4, maxLength: 9 },
  47: { decoder: decodeMissionAck, crcExtra: 153, minLength: 3, maxLength: 8 },
  49: { decoder: decodeGpsGlobalOrigin, crcExtra: 39, minLength: 12, maxLength: 20 },
  51: { decoder: decodeMissionRequestInt, crcExtra: 196, minLength: 4, maxLength: 5 },
  73: { decoder: decodeMissionItemInt, crcExtra: 38, minLength: 37, maxLength: 38 },
  74: { decoder: decodeVfrHud, crcExtra: 20, minLength: 20, maxLength: 20 },
  77: { decoder: decodeCommandAck, crcExtra: 143, minLength: 3, maxLength: 10 },
  242: { decoder: decodeHomePosition, crcExtra: 104, minLength: 52, maxLength: 60 },
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

function maybeObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isIntegerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum
}

const uint8 = (value) => isIntegerInRange(value, 0, 0xFF)
const uint16 = (value) => isIntegerInRange(value, 0, 0xFFFF)
const uint32 = (value) => isIntegerInRange(value, 0, 0xFFFFFFFF)
const int16 = (value) => isIntegerInRange(value, -0x8000, 0x7FFF)
const int32 = (value) => isIntegerInRange(value, -0x80000000, 0x7FFFFFFF)

function exactSection(keys, validators) {
  return (candidate) => {
    const section = maybeObject(candidate)
    return section !== null
      && hasExactKeys(section, keys)
      && keys.every((key) => validators[key](section[key]))
  }
}

const finite = isFiniteNumber
const boolean = (value) => typeof value === 'boolean'
const asciiParamId = (value) => typeof value === 'string'
  && value.length <= 16
  && /^[\x01-\x7F]*$/.test(value)

const JSON_PAYLOAD_SECTIONS = {
  HEARTBEAT: ['heartbeat', exactSection(
    ['customMode', 'vehicleType', 'autopilotType', 'baseMode', 'armed', 'systemStatus', 'mavlinkVersion'],
    { customMode: uint32, vehicleType: uint8, autopilotType: uint8, baseMode: uint8,
      armed: boolean, systemStatus: uint8, mavlinkVersion: uint8 },
  )],
  PARAM_VALUE: ['paramValue', exactSection(
    ['value', 'paramCount', 'paramIndex', 'paramId', 'paramType'],
    { value: finite, paramCount: uint16, paramIndex: uint16, paramId: asciiParamId, paramType: uint8 },
  )],
  GPS_RAW_INT: ['gpsRawInt', exactSection(
    ['velCms', 'cogCdeg'], { velCms: uint16, cogCdeg: uint16 },
  )],
  ATTITUDE: ['attitude', exactSection(
    ['rollRad', 'pitchRad', 'yawRad', 'pitchSpeedRadPerSec', 'yawSpeedRadPerSec'],
    { rollRad: finite, pitchRad: finite, yawRad: finite,
      pitchSpeedRadPerSec: finite, yawSpeedRadPerSec: finite },
  )],
  GLOBAL_POSITION_INT: ['globalPositionInt', exactSection(
    ['latDegE7', 'lonDegE7', 'altMm', 'relativeAltMm', 'vxCms', 'vyCms', 'vzCms', 'headingCdeg'],
    { latDegE7: int32, lonDegE7: int32, altMm: int32, relativeAltMm: int32,
      vxCms: int16, vyCms: int16, vzCms: int16, headingCdeg: uint16 },
  )],
  MISSION_REQUEST: ['missionRequest', exactSection(
    ['seq', 'targetSystem', 'targetComponent'], { seq: uint16, targetSystem: uint8, targetComponent: uint8 },
  )],
  MISSION_CURRENT: ['missionCurrent', exactSection(['seq'], { seq: uint16 })],
  MISSION_COUNT: ['missionCount', exactSection(['count'], { count: uint16 })],
  MISSION_ACK: ['missionAck', exactSection(['type'], { type: uint8 })],
  GPS_GLOBAL_ORIGIN: ['gpsGlobalOrigin', exactSection(
    ['latDegE7', 'lonDegE7', 'altMm'], { latDegE7: int32, lonDegE7: int32, altMm: int32 },
  )],
  MISSION_REQUEST_INT: ['missionRequestInt', exactSection(
    ['seq', 'targetSystem', 'targetComponent'], { seq: uint16, targetSystem: uint8, targetComponent: uint8 },
  )],
  MISSION_ITEM_INT: ['missionItemInt', exactSection(
    ['seq', 'command', 'frameId', 'current', 'autocontinue', 'param1', 'param2', 'param3', 'param4',
      'latDegE7', 'lonDegE7', 'altM'],
    { seq: uint16, command: uint16, frameId: uint8, current: boolean, autocontinue: boolean,
      param1: finite, param2: finite, param3: finite, param4: finite,
      latDegE7: int32, lonDegE7: int32, altM: finite },
  )],
  VFR_HUD: ['vfrHud', exactSection(
    ['airSpeedMps', 'groundSpeedMps', 'climbMps', 'headingDeg'],
    { airSpeedMps: finite, groundSpeedMps: finite, climbMps: finite, headingDeg: int16 },
  )],
  COMMAND_ACK: ['commandAck', exactSection(
    ['command', 'result'], { command: uint16, result: uint8 },
  )],
  HOME_POSITION: ['homePosition', exactSection(
    ['latDegE7', 'lonDegE7', 'altMm'], { latDegE7: int32, lonDegE7: int32, altMm: int32 },
  )],
}

function normalizeEnvelopeCandidate(candidate) {
  const envelopeCandidate = maybeObject(candidate)
  const envelopeKeys = ['recvTimestampMs', 'sysId', 'compId', 'messageName', 'sequence', 'payload']
  if (envelopeCandidate === null || !hasExactKeys(envelopeCandidate, envelopeKeys)) {
    return null
  }

  if (typeof envelopeCandidate.messageName !== 'string'
      || !Object.hasOwn(JSON_PAYLOAD_SECTIONS, envelopeCandidate.messageName)
      || !isFiniteNumber(envelopeCandidate.recvTimestampMs)
      || !uint8(envelopeCandidate.sysId)
      || !uint8(envelopeCandidate.compId)
      || !uint8(envelopeCandidate.sequence)) {
    return null
  }

  const sectionDefinition = JSON_PAYLOAD_SECTIONS[envelopeCandidate.messageName]
  const payload = maybeObject(envelopeCandidate.payload)
  const [sectionName, validateSection] = sectionDefinition
  if (payload === null
      || !hasExactKeys(payload, ['timestampMs', sectionName])
      || !isFiniteNumber(payload.timestampMs)
      || !validateSection(payload[sectionName])) {
    return null
  }

  return {
    recvTimestampMs: envelopeCandidate.recvTimestampMs,
    sysId: envelopeCandidate.sysId,
    compId: envelopeCandidate.compId,
    messageName: envelopeCandidate.messageName,
    sequence: envelopeCandidate.sequence,
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
  const payload = payloadPaddedTo(frame.payload, 9)
  if (payload === null) return null
  const baseMode = payload.readUInt8(6)
  return {
    messageName: 'HEARTBEAT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      heartbeat: {
        customMode: payload.readUInt32LE(0),
        vehicleType: payload.readUInt8(4),
        autopilotType: payload.readUInt8(5),
        baseMode,
        armed: (baseMode & 0x80) !== 0,
        systemStatus: payload.readUInt8(7),
        mavlinkVersion: payload.readUInt8(8),
      },
    },
  }
}

function decodeParamValue(frame) {
  const payload = payloadPaddedTo(frame.payload, 25)
  if (payload === null || payload.length < 8) return null
  const terminator = payload.indexOf(0, 8)
  const end = terminator === -1 ? 24 : Math.min(terminator, 24)
  return {
    messageName: 'PARAM_VALUE',
    payload: {
      timestampMs: frame.recvTimestampMs,
      paramValue: {
        value: payload.readFloatLE(0), paramCount: payload.readUInt16LE(4),
        paramIndex: payload.readUInt16LE(6), paramId: payload.toString('ascii', 8, end),
        paramType: payload.readUInt8(24),
      },
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

function decodeCommandAck(frame) {
  const payload = payloadPaddedTo(frame.payload, 10)
  if (payload === null || payload.length < 3) return null
  return {
    messageName: 'COMMAND_ACK',
    payload: {
      timestampMs: frame.recvTimestampMs,
      commandAck: {
        command: payload.readUInt16LE(0),
        result: payload.readUInt8(2),
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

function decodeMissionRequestInt(frame) {
  const payload = payloadPaddedTo(frame.payload, 4)
  if (payload === null) return null
  return {
    messageName: 'MISSION_REQUEST_INT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionRequestInt: {
        seq: payload.readUInt16LE(0),
        targetSystem: payload.readUInt8(2),
        targetComponent: payload.readUInt8(3),
      },
    },
  }
}

function decodeMissionRequest(frame) {
  const payload = payloadPaddedTo(frame.payload, 4)
  if (payload === null) return null
  return {
    messageName: 'MISSION_REQUEST',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionRequest: {
        seq: payload.readUInt16LE(0),
        targetSystem: payload.readUInt8(2),
        targetComponent: payload.readUInt8(3),
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
function decodeGpsGlobalOrigin(frame) {
  const payload = payloadPaddedTo(frame.payload, 12)
  if (payload === null) return null
  return { messageName: 'GPS_GLOBAL_ORIGIN', payload: { timestampMs: frame.recvTimestampMs,
    gpsGlobalOrigin: { latDegE7: payload.readInt32LE(0), lonDegE7: payload.readInt32LE(4), altMm: payload.readInt32LE(8) } } }
}

function decodeSupportedFrame(frame) {
  const definition = MESSAGE_DEFINITIONS[frame.msgId]
  if (definition === undefined) {
    return null
  }

  const decoded = definition.decoder(frame)
  if (decoded === null || !allNumbersFinite(decoded)) {
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

function allNumbersFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(allNumbersFinite)
  if (value !== null && typeof value === 'object') return Object.values(value).every(allNumbersFinite)
  return true
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

    // Signed v2 needs a verified signature policy. Reject the complete candidate
    // once, before looking at its message id or checksum bytes.
    if (magic === MAVLINK_V2_MAGIC && (rawBuffer[offset + 2] & 0x01) === 0x01) {
      decodeErrors += 1
      offset += frameLength
      continue
    }

    const definition = MESSAGE_DEFINITIONS[msgId]
    if (definition === undefined) {
      // Without dialect metadata there is no CRC_EXTRA to validate. A complete,
      // well-framed unsupported message is ignored, not mislabeled corruption.
      offset += frameLength
      continue
    }

    const validPayloadLength = magic === MAVLINK_V1_MAGIC
      ? payloadLength === definition.minLength
      : payloadLength >= 1 && payloadLength <= definition.maxLength
    if (!validPayloadLength) {
      decodeErrors += 1
      offset += frameLength
      continue
    }

    {
      const expectedCrc = rawBuffer.readUInt16LE(payloadOffset + payloadLength)
      const actualCrc = computeFrameCrc(rawBuffer, offset + 1, payloadOffset + payloadLength, definition.crcExtra)

      if (expectedCrc !== actualCrc) {
        decodeErrors += 1
        offset += frameLength
        continue
      }
    }

    const wirePayload = rawBuffer.subarray(payloadOffset, payloadOffset + payloadLength)
    const payload = magic === MAVLINK_V2_MAGIC && payloadLength < definition.maxLength
      ? (() => { const expanded = Buffer.alloc(definition.maxLength); wirePayload.copy(expanded); return expanded })()
      : wirePayload

    const frame = {
      recvTimestampMs: nowMs,
      sequence: rawBuffer[sequenceOffset] ?? 0,
      sysId: clampUint8(rawBuffer[sysIdOffset], 1),
      compId: clampUint8(rawBuffer[compIdOffset], 1),
      msgId,
      payload,
    }

    const envelope = decodeSupportedFrame(frame)
    if (envelope !== null) {
      envelopes.push(envelope)
    } else {
      // A supported, CRC-valid frame that cannot satisfy the normalized
      // language-neutral contract is one malformed candidate.
      decodeErrors += 1
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
  const jsonEnvelope = tryParseJsonEnvelope(rawBuffer)
  if (jsonEnvelope !== null) {
    return { envelopes: [jsonEnvelope], decodeErrors: 0 }
  }

  return parseMavlinkFrames(rawBuffer, nowMs)
}

let mockOutboundSequence = 0

/**
 * Encode a MISSION_COUNT reply — used only by the mission mock (mockFleet.js),
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
