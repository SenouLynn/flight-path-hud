/**
 * Compact rendering of the raw message stream, for an operator-facing log.
 *
 * Pure and framework-free like the rest of the core, so the same formatting
 * serves a browser panel, a Node log tail, or a recording dump.
 */

import type { TelemetrySample, WireFrame } from './wire'

export type LogKind = 'message' | 'decode-error'

export interface LogEntry {
  /** Monotonic within a session — a stable React key and an ordering tiebreak. */
  id: number
  kind: LogKind
  recvTimestampMs: number
  sysId: number
  compId: number
  messageName: string
  sequence: number
  /** Field digest of the payload, e.g. `rollRad=-0.021 pitchRad=0.06`. */
  summary: string
}

const SECTIONS = ['attitude', 'vfrHud', 'globalPositionInt', 'gpsRawInt'] as const

/**
 * Trailing zeros are noise in a fast-scrolling log, but rounding away a small
 * value would hide it — so keep up to 4 decimals and trim what is not needed.
 */
function formatValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Field names keep their unit suffixes (`rollRad`, not `roll`). In a debug log
 * the units are the point — they are what you are checking when a value looks
 * wrong by a factor of 100.
 */
export function describeSample(sample: TelemetrySample): string {
  const parts: string[] = []

  for (const section of SECTIONS) {
    const fields = sample[section]
    if (fields === undefined) {
      continue
    }

    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        parts.push(`${key}=${formatValue(value)}`)
      }
    }
  }

  return parts.join(' ')
}

export function toLogEntry(id: number, frame: WireFrame): LogEntry {
  return {
    id,
    kind: 'message',
    recvTimestampMs: frame.recvTimestampMs,
    sysId: frame.sysId,
    compId: frame.compId,
    messageName: frame.messageName,
    sequence: frame.sequence,
    summary: describeSample(frame.payload),
  }
}

export function toDecodeErrorEntry(id: number, recvTimestampMs: number): LogEntry {
  return {
    id,
    kind: 'decode-error',
    recvTimestampMs,
    sysId: 0,
    compId: 0,
    messageName: 'DECODE_ERROR',
    sequence: 0,
    summary: 'frame failed to parse',
  }
}

/** Append with a hard cap, dropping oldest first. Never mutates the input. */
export function appendLogEntry(entries: LogEntry[], entry: LogEntry, maxEntries: number): LogEntry[] {
  const next = [...entries, entry]
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
}

/** Message names present in the buffer, sorted — drives a filter control. */
export function logMessageNames(entries: LogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.messageName))].sort()
}
