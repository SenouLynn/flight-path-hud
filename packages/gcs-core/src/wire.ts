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

export interface FlightStateWireFrame {
  type: 'flightState'
  sysId: number
  compId: number
  armed: boolean
  baseMode: number
  customMode: number
  systemStatus: number
  vehicleType: number
  autopilotType: number
  observedAtMs: number
}

export type GuidedRepositionStatus = 'awaitingAck' | 'awaitingObservation' | 'complete' | 'failed'

export interface GuidedRepositionWireFrame {
  type: 'guidedReposition'
  requestId: string | null
  sysId: number | null
  compId: number | null
  status: GuidedRepositionStatus
  ackResult: number | null
  observed: boolean
  attempts: number
  horizontalDistanceM: number | null
  altitudeErrorM: number | null
  reason: string | null
  updatedAtMs: number
}

export type CommandLifecycleStatus = 'awaitingAck' | 'awaitingObservation' | 'complete' | 'failed'

export interface ModeChangeWireFrame {
  type: 'modeChange'; requestId: string | null; sysId: number | null; compId: number | null
  mode: string | null; customMode: number | null; status: CommandLifecycleStatus
  ackResult: number | null; observed: boolean; attempts: number; reason: string | null; updatedAtMs: number
}

export interface ArmDisarmWireFrame {
  type: 'armDisarm'; requestId: string | null; sysId: number | null; compId: number | null
  arm: boolean | null; status: CommandLifecycleStatus; ackResult: number | null
  observed: boolean; attempts: number; reason: string | null; updatedAtMs: number
}

export interface GuidedTakeoffWireFrame {
  type: 'guidedTakeoff'; requestId: string | null; sysId: number | null; compId: number | null
  relativeAltitudeM: number | null; altitudeToleranceM: number | null; status: CommandLifecycleStatus
  ackResult: number | null; observed: boolean; attempts: number; altitudeErrorM: number | null
  reason: string | null; updatedAtMs: number
}
export interface GuidedLandWireFrame {
  type: 'guidedLand'; requestId: string | null; sysId: number | null; compId: number | null
  touchdownAltitudeM: number; relativeAltitudeM: number | null; status: CommandLifecycleStatus
  ackResult: number | null; observed: boolean; attempts: number; reason: string | null; updatedAtMs: number
}

export type WireEvent =
  | { kind: 'telemetry'; frame: WireFrame }
  | { kind: 'mission'; frame: MissionWireFrame }
  | { kind: 'home'; frame: HomeWireFrame }
  | { kind: 'linkMode'; frame: LinkModeWireFrame }
  | { kind: 'flightState'; frame: FlightStateWireFrame }
  | { kind: 'guidedReposition'; frame: GuidedRepositionWireFrame }
  | { kind: 'modeChange'; frame: ModeChangeWireFrame }
  | { kind: 'armDisarm'; frame: ArmDisarmWireFrame }
  | { kind: 'guidedTakeoff'; frame: GuidedTakeoffWireFrame }
  | { kind: 'guidedLand'; frame: GuidedLandWireFrame }
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

function isUint32(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 0xffffffff
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
  if (parsed.type === 'flightState') return parseFlightStateWireFrame(parsed)
  if (parsed.type === 'guidedReposition') return parseGuidedRepositionWireFrame(parsed)
  if (parsed.type === 'modeChange') return parseModeChangeWireFrame(parsed)
  if (parsed.type === 'armDisarm') return parseArmDisarmWireFrame(parsed)
  if (parsed.type === 'guidedTakeoff') return parseGuidedTakeoffWireFrame(parsed)
  if (parsed.type === 'guidedLand') return parseGuidedLandWireFrame(parsed)

  // Fall through to existing telemetry parse for frames without type tag
  const frame = parseWireFrame(parsed)
  if (frame !== null) {
    return { kind: 'telemetry', frame }
  }

  return { kind: 'unrecognized' }
}

const commandStatuses: CommandLifecycleStatus[] = ['awaitingAck', 'awaitingObservation', 'complete', 'failed']
function commandBase(value: Record<string, unknown>): boolean {
  return (value.requestId === null || isNonEmptyString(value.requestId))
    && (value.sysId === null || (isUint8(value.sysId) && value.sysId > 0))
    && (value.compId === null || (isUint8(value.compId) && value.compId > 0))
    && commandStatuses.includes(value.status as CommandLifecycleStatus)
    && nullableFinite(value.ackResult) && typeof value.observed === 'boolean'
    && isNonNegativeInteger(value.attempts)
    && (value.reason === null || typeof value.reason === 'string') && isFiniteNumber(value.updatedAtMs)
}

function parseModeChangeWireFrame(value: Record<string, unknown>): WireEvent {
  if (!commandBase(value) || (value.mode !== null && typeof value.mode !== 'string')
    || !nullableFinite(value.customMode)) return { kind: 'unrecognized' }
  return { kind: 'modeChange', frame: value as unknown as ModeChangeWireFrame }
}
function parseArmDisarmWireFrame(value: Record<string, unknown>): WireEvent {
  if (!commandBase(value) || (value.arm !== null && typeof value.arm !== 'boolean')) return { kind: 'unrecognized' }
  return { kind: 'armDisarm', frame: value as unknown as ArmDisarmWireFrame }
}
function parseGuidedTakeoffWireFrame(value: Record<string, unknown>): WireEvent {
  if (!commandBase(value) || !nullableFinite(value.relativeAltitudeM)
    || !nullableFinite(value.altitudeToleranceM) || !nullableFinite(value.altitudeErrorM)) return { kind: 'unrecognized' }
  return { kind: 'guidedTakeoff', frame: value as unknown as GuidedTakeoffWireFrame }
}
function parseGuidedLandWireFrame(value: Record<string, unknown>): WireEvent {
  if (!commandBase(value) || !isFiniteNumber(value.touchdownAltitudeM)
    || !nullableFinite(value.relativeAltitudeM)) return { kind: 'unrecognized' }
  return { kind: 'guidedLand', frame: value as unknown as GuidedLandWireFrame }
}

function parseFlightStateWireFrame(value: Record<string, unknown>): WireEvent {
  if (!isUint8(value.sysId) || value.sysId === 0 || !isUint8(value.compId) || value.compId === 0
    || typeof value.armed !== 'boolean'
    || !isUint8(value.baseMode) || !isUint32(value.customMode) || !isUint8(value.systemStatus)
    || !isUint8(value.vehicleType) || !isUint8(value.autopilotType)
    || !isFiniteNumber(value.observedAtMs)) return { kind: 'unrecognized' }
  return { kind: 'flightState', frame: { type: 'flightState', sysId: value.sysId,
    compId: value.compId, armed: value.armed, baseMode: value.baseMode as number,
    customMode: value.customMode as number, systemStatus: value.systemStatus as number,
    vehicleType: value.vehicleType as number, autopilotType: value.autopilotType as number,
    observedAtMs: value.observedAtMs as number } }
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function parseGuidedRepositionWireFrame(value: Record<string, unknown>): WireEvent {
  const statuses: GuidedRepositionStatus[] = ['awaitingAck', 'awaitingObservation', 'complete', 'failed']
  if ((value.requestId !== null && !isNonEmptyString(value.requestId))
    || (value.sysId !== null && (!isUint8(value.sysId) || value.sysId === 0))
    || (value.compId !== null && (!isUint8(value.compId) || value.compId === 0))
    || !statuses.includes(value.status as GuidedRepositionStatus)
    || !nullableFinite(value.ackResult) || typeof value.observed !== 'boolean'
    || !isNonNegativeInteger(value.attempts) || !nullableFinite(value.horizontalDistanceM)
    || !nullableFinite(value.altitudeErrorM) || (value.reason !== null && typeof value.reason !== 'string')
    || !isFiniteNumber(value.updatedAtMs)) return { kind: 'unrecognized' }
  return { kind: 'guidedReposition', frame: { type: 'guidedReposition',
    requestId: value.requestId as string | null, sysId: value.sysId as number | null,
    compId: value.compId as number | null, status: value.status as GuidedRepositionStatus,
    ackResult: value.ackResult, observed: value.observed, attempts: value.attempts,
    horizontalDistanceM: value.horizontalDistanceM, altitudeErrorM: value.altitudeErrorM,
    reason: value.reason as string | null, updatedAtMs: value.updatedAtMs } }
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
