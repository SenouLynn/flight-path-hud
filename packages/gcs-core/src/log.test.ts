import { describe, expect, it } from 'vitest'
import { appendLogEntry, describeSample, logMessageNames, toDecodeErrorEntry, toLogEntry } from './log'
import type { LogEntry } from './log'
import type { WireFrame } from './wire'

function frame(messageName: string, payload: Partial<WireFrame['payload']>): WireFrame {
  return {
    recvTimestampMs: 1000,
    sysId: 1,
    compId: 1,
    messageName,
    sequence: 7,
    payload: { timestampMs: 1000, ...payload },
  }
}

describe('describeSample', () => {
  it('lists the fields a message actually carried', () => {
    const summary = describeSample({
      timestampMs: 1,
      attitude: { rollRad: -0.021, pitchRad: 0.06 },
    })

    expect(summary).toBe('rollRad=-0.021 pitchRad=0.06')
  })

  it('keeps unit suffixes, since a wrong scale is what a log is used to spot', () => {
    const summary = describeSample({ timestampMs: 1, globalPositionInt: { latDegE7: 473977420 } })

    expect(summary).toContain('latDegE7=473977420')
  })

  it('skips fields the message did not populate', () => {
    // Sanitizing writes absent fields as explicit undefined, so they are present
    // as keys and must not be printed.
    const summary = describeSample({
      timestampMs: 1,
      vfrHud: { headingDeg: 90, airSpeedMps: undefined, groundSpeedMps: undefined, climbMps: undefined },
    })

    expect(summary).toBe('headingDeg=90')
  })

  it('trims trailing zeros without hiding small values', () => {
    const summary = describeSample({
      timestampMs: 1,
      attitude: { rollRad: 0.5, pitchRad: 0.00012, yawRad: 3 },
    })

    expect(summary).toBe('rollRad=0.5 pitchRad=0.0001 yawRad=3')
  })

  it('is empty for a sample with no populated sections', () => {
    expect(describeSample({ timestampMs: 1 })).toBe('')
  })
})

describe('toLogEntry', () => {
  it('carries the envelope identity alongside the digest', () => {
    const entry = toLogEntry(3, frame('ATTITUDE', { attitude: { rollRad: 0.1 } }))

    expect(entry).toMatchObject({
      id: 3,
      kind: 'message',
      messageName: 'ATTITUDE',
      sysId: 1,
      sequence: 7,
      summary: 'rollRad=0.1',
    })
  })

  it('marks decode failures so they are visible in the same stream', () => {
    const entry = toDecodeErrorEntry(9, 5000)

    expect(entry.kind).toBe('decode-error')
    expect(entry.messageName).toBe('DECODE_ERROR')
    expect(entry.recvTimestampMs).toBe(5000)
  })
})

describe('appendLogEntry', () => {
  const entry = (id: number): LogEntry => toLogEntry(id, frame('HEARTBEAT', {}))

  it('appends within the cap', () => {
    const result = appendLogEntry([entry(1)], entry(2), 10)

    expect(result.map((e) => e.id)).toEqual([1, 2])
  })

  it('drops the oldest once the cap is reached', () => {
    let entries: LogEntry[] = []
    for (let id = 1; id <= 6; id += 1) {
      entries = appendLogEntry(entries, entry(id), 3)
    }

    expect(entries.map((e) => e.id)).toEqual([4, 5, 6])
  })

  it('does not mutate the input', () => {
    const original = [entry(1)]
    appendLogEntry(original, entry(2), 10)

    expect(original).toHaveLength(1)
  })
})

describe('logMessageNames', () => {
  it('returns the distinct names, sorted, for a filter control', () => {
    const entries = [
      toLogEntry(1, frame('VFR_HUD', {})),
      toLogEntry(2, frame('ATTITUDE', {})),
      toLogEntry(3, frame('VFR_HUD', {})),
    ]

    expect(logMessageNames(entries)).toEqual(['ATTITUDE', 'VFR_HUD'])
  })
})
