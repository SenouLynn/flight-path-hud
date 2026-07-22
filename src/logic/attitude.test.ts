import { describe, expect, it } from 'vitest'
import {
  computeHorizonTransform,
  normalizeRollDegrees,
  radiansToDegrees,
  resolveAttitude,
} from './attitude'
import { ATTITUDE_VALIDATION_FRAMES, runAttitudeReplay } from './replay'

describe('attitude utilities', () => {
  it('converts radians to degrees', () => {
    expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90, 8)
    expect(radiansToDegrees(-Math.PI / 4)).toBeCloseTo(-45, 8)
  })

  it('normalizes roll into [-180, 180)', () => {
    expect(normalizeRollDegrees(190)).toBe(-170)
    expect(normalizeRollDegrees(-200)).toBe(160)
    expect(normalizeRollDegrees(30)).toBe(30)
  })
})

describe('resolveAttitude', () => {
  it('returns null attitude when pitch or roll is missing', () => {
    const resolved = resolveAttitude({
      timestampMs: 0,
      attitude: { pitchRad: 0.3 },
    })

    expect(resolved.hasAttitude).toBe(false)
    expect(resolved.pitchDeg).toBeNull()
    expect(resolved.rollDeg).toBeNull()
  })

  it('resolves pitch and roll from ATTITUDE radians', () => {
    const resolved = resolveAttitude({
      timestampMs: 0,
      attitude: {
        pitchRad: Math.PI / 18,
        rollRad: -Math.PI / 6,
      },
    })

    expect(resolved.hasAttitude).toBe(true)
    expect(resolved.pitchDeg).toBeCloseTo(10, 8)
    expect(resolved.rollDeg).toBeCloseTo(-30, 8)
  })
})

describe('computeHorizonTransform', () => {
  it('creates a horizontal line in level flight', () => {
    const transform = computeHorizonTransform({
      timestampMs: 0,
      attitude: {
        pitchRad: 0,
        rollRad: 0,
      },
    })

    expect(transform).not.toBeNull()
    expect(transform?.pitchOffsetPx).toBeCloseTo(0, 8)
    expect(transform?.start.y).toBeCloseTo(0, 8)
    expect(transform?.end.y).toBeCloseTo(0, 8)
  })

  it('moves horizon down for positive pitch by default config', () => {
    const transform = computeHorizonTransform({
      timestampMs: 0,
      attitude: {
        pitchRad: Math.PI / 18,
        rollRad: 0,
      },
    })

    expect(transform).not.toBeNull()
    expect(transform?.pitchOffsetPx).toBeCloseTo(60, 8)
    expect(transform?.start.y).toBeCloseTo(60, 8)
    expect(transform?.end.y).toBeCloseTo(60, 8)
  })

  it('tilts line with positive roll', () => {
    const transform = computeHorizonTransform({
      timestampMs: 0,
      attitude: {
        pitchRad: 0,
        rollRad: Math.PI / 6,
      },
    })

    expect(transform).not.toBeNull()
    expect(transform?.start.y).toBeLessThan(0)
    expect(transform?.end.y).toBeGreaterThan(0)
  })
})

describe('runAttitudeReplay', () => {
  it('matches expected values for canonical attitude frames', () => {
    const replay = runAttitudeReplay(ATTITUDE_VALIDATION_FRAMES)

    expect(replay).toHaveLength(ATTITUDE_VALIDATION_FRAMES.length)

    for (const row of replay) {
      if (row.expectedPitchDeg === null) {
        expect(row.transform).toBeNull()
        continue
      }

      expect(row.transform).not.toBeNull()
      expect(row.pitchErrorDeg).toBeLessThan(0.000001)
      expect(row.rollErrorDeg).toBeLessThan(0.000001)
      expect(row.pitchOffsetErrorPx).toBeLessThan(0.000001)
    }
  })
})
