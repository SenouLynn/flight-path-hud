/**
 * Folds the bridge's one-message-per-frame stream into a coherent vehicle state.
 *
 * Pure: the caller threads the previous state back in, so the accumulation lives
 * in whatever adapter is driving (a React hook, a Node log reader) and never in
 * this module.
 */

import { cdegToDeg, degE7ToDeg } from './geodesy'
import type { TelemetrySample, WireFrame } from './wire'

/** Which field the displayed heading came from — provenance for debugging. */
export type HeadingSource = 'VFR_HUD.heading' | 'GLOBAL_POSITION_INT.hdg' | 'none'

export interface VehicleState {
  sysId: number
  compId: number
  latDeg: number | null
  lonDeg: number | null
  altMslM: number | null
  altRelM: number | null
  headingDeg: number | null
  headingSource: HeadingSource
  /** When the current heading arrived — drives the fallback-staleness rule. */
  headingUpdatedMs: number | null
  groundSpeedMps: number | null
  lastUpdateMs: number
  /**
   * Fields merged across frames. The bridge sends one message per frame, so this
   * is the only place a complete picture exists — the HUD instruments render
   * straight from it, sharing the map's fold rather than duplicating it.
   */
  sample: TelemetrySample
}

/**
 * How long a VFR_HUD heading stays authoritative before GLOBAL_POSITION_INT.hdg
 * may take over again.
 *
 * Both messages carry a heading, and on a real vehicle they differ slightly. The
 * bridge sends one message per frame, so "use whatever this frame carried" would
 * alternate between the two every few milliseconds and jitter the displayed
 * heading. Sticking to one source until it actually goes quiet avoids that —
 * the same failure mode that made the ground track flip between
 * GLOBAL_POSITION_INT.vx/vy and GPS_RAW_INT.cog.
 */
export const HEADING_FALLBACK_AFTER_MS = 2000

const EMPTY: Omit<VehicleState, 'sysId' | 'compId' | 'lastUpdateMs' | 'sample'> = {
  latDeg: null,
  lonDeg: null,
  altMslM: null,
  altRelM: null,
  headingDeg: null,
  headingSource: 'none',
  headingUpdatedMs: null,
  groundSpeedMps: null,
}

/**
 * Merge one telemetry section, keeping a previous value where the newer frame
 * carried an explicit `undefined`. Sanitizing writes every absent field as
 * `undefined`, so a plain spread would blank known-good siblings.
 */
function mergeSection<T extends object>(previous: T | undefined, next: T | undefined): T | undefined {
  if (next === undefined) {
    return previous
  }

  if (previous === undefined) {
    return next
  }

  const merged = { ...previous } as Record<string, unknown>
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) {
      merged[key] = value
    }
  }

  return merged as T
}

function mergeSample(previous: TelemetrySample | null, next: TelemetrySample): TelemetrySample {
  return {
    timestampMs: next.timestampMs,
    attitude: mergeSection(previous?.attitude, next.attitude),
    vfrHud: mergeSection(previous?.vfrHud, next.vfrHud),
    globalPositionInt: mergeSection(previous?.globalPositionInt, next.globalPositionInt),
    gpsRawInt: mergeSection(previous?.gpsRawInt, next.gpsRawInt),
  }
}

/**
 * Take the newer value only when the frame actually carried one.
 *
 * The bridge emits an explicit `undefined` for every field a message did not
 * populate, so a naive "newest wins" would blank a known-good fix every time a
 * non-position message arrived.
 */
function carry<T>(previous: T | null, next: T | undefined): T | null {
  return next === undefined ? previous : next
}

type HeadingFields = Pick<VehicleState, 'headingDeg' | 'headingSource' | 'headingUpdatedMs'>

function readHeading(frame: WireFrame, previous: HeadingFields): HeadingFields {
  const nowMs = frame.recvTimestampMs

  const vfrHeading = frame.payload.vfrHud?.headingDeg
  if (vfrHeading !== undefined) {
    return { headingDeg: vfrHeading, headingSource: 'VFR_HUD.heading', headingUpdatedMs: nowMs }
  }

  const headingCdeg = frame.payload.globalPositionInt?.headingCdeg
  if (headingCdeg !== undefined) {
    // 65535 means "unknown" on the wire, so a valid reading may be absent here.
    const resolved = cdegToDeg(headingCdeg)

    const vfrIsStale = previous.headingSource !== 'VFR_HUD.heading'
      || previous.headingUpdatedMs === null
      || nowMs - previous.headingUpdatedMs > HEADING_FALLBACK_AFTER_MS

    if (resolved !== null && vfrIsStale) {
      return { headingDeg: resolved, headingSource: 'GLOBAL_POSITION_INT.hdg', headingUpdatedMs: nowMs }
    }
  }

  return previous
}

export function mergeVehicleState(previous: VehicleState | null, frame: WireFrame): VehicleState {
  const base = previous ?? {
    ...EMPTY,
    sysId: frame.sysId,
    compId: frame.compId,
    lastUpdateMs: frame.recvTimestampMs,
    sample: { timestampMs: frame.payload.timestampMs },
  }
  const sample = mergeSample(previous?.sample ?? null, frame.payload)
  const globalPosition = frame.payload.globalPositionInt
  const heading = readHeading(frame, base)

  const latDegE7 = carry(null, globalPosition?.latDegE7)
  const lonDegE7 = carry(null, globalPosition?.lonDegE7)
  const altMm = carry(null, globalPosition?.altMm)
  const altRelMm = carry(null, globalPosition?.relativeAltMm)

  return {
    sysId: frame.sysId,
    compId: frame.compId,
    latDeg: latDegE7 === null ? base.latDeg : degE7ToDeg(latDegE7),
    lonDeg: lonDegE7 === null ? base.lonDeg : degE7ToDeg(lonDegE7),
    altMslM: altMm === null ? base.altMslM : altMm / 1000,
    altRelM: altRelMm === null ? base.altRelM : altRelMm / 1000,
    headingDeg: heading.headingDeg,
    headingSource: heading.headingSource,
    headingUpdatedMs: heading.headingUpdatedMs,
    groundSpeedMps: carry(base.groundSpeedMps, frame.payload.vfrHud?.groundSpeedMps),
    lastUpdateMs: frame.recvTimestampMs,
    sample,
  }
}

/** A vehicle is only mappable once it has both coordinates. */
export function hasFix(state: VehicleState | null): state is VehicleState & { latDeg: number, lonDeg: number } {
  return state !== null && state.latDeg !== null && state.lonDeg !== null
}
