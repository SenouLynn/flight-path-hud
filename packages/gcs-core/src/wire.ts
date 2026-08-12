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

export interface MissionItemWire {
  seq: number
  command: number
  current: boolean
  autocontinue: boolean
  latDeg: number
  lonDeg: number
  altM: number
}

export interface MissionWireFrame {
  type: 'mission'
  sysId: number
  compId: number
  status: 'pending' | 'complete' | 'failed'
  items: MissionItemWire[]
  /** A `seq` value, NOT an array index. Compare with `item.seq === activeIndex`, never `items[activeIndex]`. */
  activeIndex: number | null
  reason: string | null
}

export interface HomeWireFrame {
  type: 'home'
  sysId: number
  compId: number
  lat: number
  lon: number
  altMslM: number
}

export interface LinkModeWireFrame {
  type: 'linkMode'
  replayMode: boolean
}

export type WireEvent =
  | { kind: 'telemetry'; frame: WireFrame }
  | { kind: 'mission'; frame: MissionWireFrame }
  | { kind: 'home'; frame: HomeWireFrame }
  | { kind: 'linkMode'; frame: LinkModeWireFrame }
  | { kind: 'unrecognized' }

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

/**
 * Parse a raw socket message into a tagged event. Non-string data and bad JSON
 * both yield `{kind:'unrecognized'}`, same discipline as parseWireMessage. Once
 * parsed, discriminates on `value.type` BEFORE attempting the existing telemetry
 * parse, so a `{type:'mission',...}` frame is never run through parseWireFrame and
 * vice versa. Absence of `type` (or a `type` that isn't one of the three known
 * tags) falls through to parseWireFrame — every existing telemetry frame must be
 * handled byte-for-byte exactly as before.
 *
 * Each tagged branch does its own guard-then-rebuild field validation, same
 * discipline as parseWireFrame: `status` must be one of the three literal strings,
 * `items` must be an array of well-formed MissionItemWire objects (every field
 * present and correctly typed — reject the whole frame if any item is malformed),
 * `activeIndex`/`reason` must be `number|null`/`string|null`, `replayMode` must be
 * boolean. Any malformed field on a tagged message returns {kind:'unrecognized'},
 * never throws and never passes through a partially-valid object.
 */
export function parseWireEvent(data: unknown): WireEvent {
  if (typeof data !== 'string') {
    return { kind: 'unrecognized' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return { kind: 'unrecognized' }
  }

  if (!isObject(parsed)) {
    return { kind: 'unrecognized' }
  }

  // Check for tagged frame types before falling through to telemetry parse
  if (parsed.type === 'mission') {
    return parseMissionWireFrame(parsed)
  }

  if (parsed.type === 'home') {
    return parseHomeWireFrame(parsed)
  }

  if (parsed.type === 'linkMode') {
    return parseLinkModeWireFrame(parsed)
  }

  // Fall through to existing telemetry parse for frames without type tag
  const frame = parseWireFrame(parsed)
  if (frame !== null) {
    return { kind: 'telemetry', frame }
  }

  return { kind: 'unrecognized' }
}

function parseMissionWireFrame(value: Record<string, unknown>): WireEvent {
  // Validate sysId and compId
  if (!isUint8(value.sysId) || !isUint8(value.compId)) {
    return { kind: 'unrecognized' }
  }

  // Validate status is one of the three allowed values
  if (value.status !== 'pending' && value.status !== 'complete' && value.status !== 'failed') {
    return { kind: 'unrecognized' }
  }

  // Validate items is an array
  if (!Array.isArray(value.items)) {
    return { kind: 'unrecognized' }
  }

  // Validate all items are well-formed MissionItemWire objects
  const items: MissionItemWire[] = []
  for (const item of value.items) {
    if (!isObject(item)) {
      return { kind: 'unrecognized' }
    }

    if (
      !isNonNegativeInteger(item.seq) ||
      !isNonNegativeInteger(item.command) ||
      typeof item.current !== 'boolean' ||
      typeof item.autocontinue !== 'boolean' ||
      !isFiniteNumber(item.latDeg) ||
      !isFiniteNumber(item.lonDeg) ||
      !isFiniteNumber(item.altM)
    ) {
      return { kind: 'unrecognized' }
    }

    items.push({
      seq: item.seq,
      command: item.command,
      current: item.current,
      autocontinue: item.autocontinue,
      latDeg: item.latDeg,
      lonDeg: item.lonDeg,
      altM: item.altM,
    })
  }

  // Validate activeIndex is number or null
  if (value.activeIndex !== null && !isNonNegativeInteger(value.activeIndex)) {
    return { kind: 'unrecognized' }
  }

  // Validate reason is string or null
  if (value.reason !== null && typeof value.reason !== 'string') {
    return { kind: 'unrecognized' }
  }

  return {
    kind: 'mission',
    frame: {
      type: 'mission',
      sysId: value.sysId as number,
      compId: value.compId as number,
      status: value.status as 'pending' | 'complete' | 'failed',
      items,
      activeIndex: value.activeIndex as number | null,
      reason: value.reason as string | null,
    },
  }
}

function parseHomeWireFrame(value: Record<string, unknown>): WireEvent {
  // Validate sysId and compId
  if (!isUint8(value.sysId) || !isUint8(value.compId)) {
    return { kind: 'unrecognized' }
  }

  // Validate coordinates and altitude
  if (!isFiniteNumber(value.lat) || !isFiniteNumber(value.lon) || !isFiniteNumber(value.altMslM)) {
    return { kind: 'unrecognized' }
  }

  return {
    kind: 'home',
    frame: {
      type: 'home',
      sysId: value.sysId as number,
      compId: value.compId as number,
      lat: value.lat as number,
      lon: value.lon as number,
      altMslM: value.altMslM as number,
    },
  }
}

function parseLinkModeWireFrame(value: Record<string, unknown>): WireEvent {
  // Validate replayMode is boolean
  if (typeof value.replayMode !== 'boolean') {
    return { kind: 'unrecognized' }
  }

  return {
    kind: 'linkMode',
    frame: {
      type: 'linkMode',
      replayMode: value.replayMode,
    },
  }
}

/**
 * Encode the one outbound message shape this app ever sends. Returns null (encodes
 * nothing) when sysId/compId is not an integer in [0,255] — mirrors the bridge's own
 * validation in missionRouter.js ("expected integers in the range 0-255"), so a
 * caller never has to duplicate that range check.
 */
export function encodeRequestMission(sysId: number, compId: number): string | null {
  // Validate sysId and compId are in valid range [0, 255]
  if (!isUint8(sysId) || !isUint8(compId)) {
    return null
  }

  return JSON.stringify({
    type: 'requestMission',
    sysId,
    compId,
  })
}

/** Stable identity for a vehicle on the link. */
export function systemKey(sysId: number, compId: number): string {
  return `${sysId}:${compId}`
}
