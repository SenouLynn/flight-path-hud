/**
 * The mavlink-bridge wire contract, as consumed by the GCS.
 *
 * This is deliberately a *wire* contract rather than a shared code dependency on
 * apps/hud: the bridge's WebSocket is the boundary between the two, so modelling
 * it independently keeps the GCS decoupled from the HUD harness.
 *
 * Only the fields a map needs are modelled. Unmodelled payload sections are
 * ignored rather than re-declared.
 */

import { sanitizeTelemetrySample, type TelemetrySample } from '@flight-path-hud/hud-ui/logic/telemetry'

export type { TelemetrySample }

export interface WireFrame {
  recvTimestampMs: number
  sysId: number
  compId: number
  messageName: string
  sequence: number
  /**
   * The canonical sample shape, owned by hud-ui. Carrying the whole thing rather
   * than a map-sized subset means one merge feeds both the map and the HUD
   * instruments, instead of two parallel folds that can disagree.
   */
  payload: TelemetrySample
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

/**
 * Guard then rebuild, field by field — the parsed frame never aliases the input
 * object, so a malformed extra key can't leak downstream.
 *
 * Returns `null` rather than throwing: a malformed frame is an expected event on
 * a live socket, not an exceptional one.
 */
export function parseWireFrame(value: unknown): WireFrame | null {
  if (!isObject(value)) {
    return null
  }

  if (!isFiniteNumber(value.recvTimestampMs)) {
    return null
  }

  if (!isUint8(value.sysId) || !isUint8(value.compId) || !isUint8(value.sequence)) {
    return null
  }

  if (!isNonEmptyString(value.messageName)) {
    return null
  }

  if (!isObject(value.payload) || !isFiniteNumber(value.payload.timestampMs)) {
    return null
  }

  return {
    recvTimestampMs: value.recvTimestampMs,
    sysId: value.sysId,
    compId: value.compId,
    messageName: value.messageName,
    sequence: value.sequence,
    // Sanitizing drops non-finite values and unknown sections, so the parsed
    // frame never aliases the input object.
    payload: sanitizeTelemetrySample(value.payload as unknown as TelemetrySample),
  }
}

/** Parse a raw socket message. Non-string data and bad JSON both yield `null`. */
export function parseWireMessage(data: unknown): WireFrame | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    return parseWireFrame(JSON.parse(data))
  } catch {
    return null
  }
}

/** Stable identity for a vehicle on the link. */
export function systemKey(sysId: number, compId: number): string {
  return `${sysId}:${compId}`
}
