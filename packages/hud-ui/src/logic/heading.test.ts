import { describe, expect, it } from 'vitest'
import {
  normalizeHeadingDegrees,
  resolveHeading,
  UNKNOWN_GLOBAL_HEADING_VALUE,
  yawRadiansToHeadingDegrees,
} from './heading'
import { HEADING_VALIDATION_FRAMES, runHeadingReplay } from './replay'

describe('heading normalization', () => {
  it('normalizes negative and positive overflow headings', () => {
    expect(normalizeHeadingDegrees(-10)).toBe(350)
    expect(normalizeHeadingDegrees(370)).toBe(10)
    expect(normalizeHeadingDegrees(720)).toBe(0)
  })

  it('converts yaw radians into 0-360 heading', () => {
    expect(yawRadiansToHeadingDegrees(-Math.PI / 2)).toBeCloseTo(270, 8)
    expect(yawRadiansToHeadingDegrees(Math.PI)).toBeCloseTo(180, 8)
  })
})

describe('resolveHeading', () => {
  it('uses VFR_HUD heading as primary source', () => {
    const resolved = resolveHeading({
      timestampMs: 0,
      vfrHud: { headingDeg: 91 },
      attitude: { yawRad: Math.PI },
    })

    expect(resolved.source).toBe('VFR_HUD.heading')
    expect(resolved.isFallback).toBe(false)
    expect(resolved.headingDeg).toBe(91)
  })

  it('falls back to ATTITUDE yaw when VFR heading is unavailable', () => {
    const resolved = resolveHeading({
      timestampMs: 0,
      attitude: { yawRad: -Math.PI / 2 },
    })

    expect(resolved.source).toBe('ATTITUDE.yaw')
    expect(resolved.isFallback).toBe(true)
    expect(resolved.headingDeg).toBeCloseTo(270, 8)
  })

  it('falls back to GLOBAL_POSITION_INT heading when available and valid', () => {
    const resolved = resolveHeading({
      timestampMs: 0,
      globalPositionInt: { headingCdeg: 35999 },
    })

    expect(resolved.source).toBe('GLOBAL_POSITION_INT.hdg')
    expect(resolved.isFallback).toBe(true)
    expect(resolved.headingDeg).toBeCloseTo(359.99, 8)
  })

  it('returns none when heading is missing or unknown', () => {
    const unknownGlobal = resolveHeading({
      timestampMs: 0,
      globalPositionInt: { headingCdeg: UNKNOWN_GLOBAL_HEADING_VALUE },
    })

    const emptySample = resolveHeading({
      timestampMs: 0,
    })

    expect(unknownGlobal.source).toBe('none')
    expect(unknownGlobal.headingDeg).toBeNull()
    expect(emptySample.source).toBe('none')
    expect(emptySample.headingDeg).toBeNull()
  })
})

describe('runHeadingReplay', () => {
  it('matches expected values for canonical replay frames', () => {
    const replay = runHeadingReplay(HEADING_VALIDATION_FRAMES)

    expect(replay).toHaveLength(HEADING_VALIDATION_FRAMES.length)

    for (const row of replay) {
      const fixture = HEADING_VALIDATION_FRAMES.find((candidate) => candidate.id === row.id)
      expect(fixture).toBeDefined()
      expect(row.result.source).toBe(fixture?.expectedSource)
      expect(row.result.isFallback).toBe(fixture?.expectedIsFallback)

      if (row.expectedHeadingDeg === null) {
        expect(row.result.headingDeg).toBeNull()
        continue
      }

      expect(row.result.headingDeg).not.toBeNull()
      expect(row.absoluteErrorDeg).toBeLessThanOrEqual(fixture?.toleranceDeg ?? 0)
    }
  })
})
