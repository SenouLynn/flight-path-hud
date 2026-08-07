const UINT8_MAX = 255

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

export function parseIncomingDatagram(rawBuffer) {
  const bodyText = rawBuffer.toString('utf8')
  let parsed

  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object') {
    return null
  }

  const envelopeCandidate = parsed

  const messageName = normalizeMessageName(envelopeCandidate.messageName)
  if (messageName === null) {
    return null
  }

  const payload = envelopeCandidate.payload
  if (!isTelemetryPayload(payload)) {
    return null
  }

  const sequence = isNonNegativeInteger(envelopeCandidate.sequence)
    ? envelopeCandidate.sequence
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
