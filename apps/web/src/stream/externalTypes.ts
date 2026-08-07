import type { TelemetrySample } from '../logic/telemetry'
import { sanitizeTelemetrySample } from '../logic/telemetry'

export type StreamConnectionState = 'connecting' | 'open' | 'closed' | 'error'

export interface ExternalStreamHealth {
  connectionState?: StreamConnectionState
  packetRateHz?: number
  decodeErrorCount?: number
  droppedPacketCount?: number
  lastHeartbeatAgeMs?: number
}

export interface ExternalTelemetryEnvelope {
  recvTimestampMs: number
  sysId: number
  compId: number
  messageName: string
  sequence: number
  payload: TelemetrySample
  health?: ExternalStreamHealth
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isFiniteNumber(value) && value >= 0
}

function isUint8(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 255
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isKnownConnectionState(value: unknown): value is StreamConnectionState {
  return value === 'connecting' || value === 'open' || value === 'closed' || value === 'error'
}

function isTelemetrySampleCandidate(value: unknown): value is TelemetrySample {
  if (!isObject(value)) {
    return false
  }

  return isFiniteNumber(value.timestampMs)
}

function isExternalStreamHealth(value: unknown): value is ExternalStreamHealth {
  if (!isObject(value)) {
    return false
  }

  if (value.connectionState !== undefined && !isKnownConnectionState(value.connectionState)) {
    return false
  }

  if (value.packetRateHz !== undefined && !isFiniteNumber(value.packetRateHz)) {
    return false
  }

  if (value.decodeErrorCount !== undefined && !isNonNegativeInteger(value.decodeErrorCount)) {
    return false
  }

  if (value.droppedPacketCount !== undefined && !isNonNegativeInteger(value.droppedPacketCount)) {
    return false
  }

  if (value.lastHeartbeatAgeMs !== undefined && !isNonNegativeInteger(value.lastHeartbeatAgeMs)) {
    return false
  }

  return true
}

export function isExternalTelemetryEnvelope(value: unknown): value is ExternalTelemetryEnvelope {
  if (!isObject(value)) {
    return false
  }

  if (!isFiniteNumber(value.recvTimestampMs)) {
    return false
  }

  if (!isUint8(value.sysId) || !isUint8(value.compId) || !isUint8(value.sequence)) {
    return false
  }

  if (!isNonEmptyString(value.messageName)) {
    return false
  }

  if (!isTelemetrySampleCandidate(value.payload)) {
    return false
  }

  if (value.health !== undefined && !isExternalStreamHealth(value.health)) {
    return false
  }

  return true
}

export function parseExternalTelemetryEnvelope(value: unknown): ExternalTelemetryEnvelope | null {
  if (!isExternalTelemetryEnvelope(value)) {
    return null
  }

  return {
    recvTimestampMs: value.recvTimestampMs,
    sysId: value.sysId,
    compId: value.compId,
    messageName: value.messageName,
    sequence: value.sequence,
    payload: sanitizeTelemetrySample(value.payload),
    health: value.health,
  }
}
