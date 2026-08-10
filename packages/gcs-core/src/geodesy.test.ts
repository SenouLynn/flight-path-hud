import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_HEADING_CDEG,
  bearingDeg,
  cdegToDeg,
  degE7ToDeg,
  distanceM,
  normalizeBearingDeg,
} from './geodesy'

// Zürich-ish, matching the sample sender's launch point.
const ORIGIN = { latDeg: 47.397742, lonDeg: 8.545594 }

describe('geodesy conversions', () => {
  it('scales degE7 integers to degrees', () => {
    expect(degE7ToDeg(473977420)).toBeCloseTo(47.397742, 8)
    expect(degE7ToDeg(-1223961000)).toBeCloseTo(-122.3961, 8)
  })

  it('scales centidegrees to degrees', () => {
    expect(cdegToDeg(18000)).toBeCloseTo(180, 8)
    expect(cdegToDeg(0)).toBe(0)
  })

  it('treats the 65535 sentinel as unknown heading rather than 655.35 degrees', () => {
    expect(cdegToDeg(UNKNOWN_HEADING_CDEG)).toBeNull()
  })

  it('wraps bearings into [0, 360)', () => {
    expect(normalizeBearingDeg(0)).toBe(0)
    expect(normalizeBearingDeg(360)).toBe(0)
    expect(normalizeBearingDeg(-90)).toBe(270)
    expect(normalizeBearingDeg(450)).toBe(90)
  })
})

describe('distanceM', () => {
  it('is zero for identical points', () => {
    expect(distanceM(ORIGIN, ORIGIN)).toBeCloseTo(0, 9)
  })

  it('measures one degree of latitude as ~111.2 km', () => {
    const north = { latDeg: ORIGIN.latDeg + 1, lonDeg: ORIGIN.lonDeg }
    expect(distanceM(ORIGIN, north) / 1000).toBeCloseTo(111.195, 2)
  })

  it('shrinks a degree of longitude by cos(latitude)', () => {
    const east = { latDeg: ORIGIN.latDeg, lonDeg: ORIGIN.lonDeg + 1 }
    const expectedKm = 111.195 * Math.cos((ORIGIN.latDeg * Math.PI) / 180)
    expect(distanceM(ORIGIN, east) / 1000).toBeCloseTo(expectedKm, 1)
  })

  it('is symmetric', () => {
    const other = { latDeg: 48, lonDeg: 9 }
    expect(distanceM(ORIGIN, other)).toBeCloseTo(distanceM(other, ORIGIN), 6)
  })
})

describe('bearingDeg', () => {
  it('reads due north and due south exactly, since meridians are great circles', () => {
    expect(bearingDeg(ORIGIN, { latDeg: ORIGIN.latDeg + 1, lonDeg: ORIGIN.lonDeg })).toBeCloseTo(0, 6)
    expect(bearingDeg(ORIGIN, { latDeg: ORIGIN.latDeg - 1, lonDeg: ORIGIN.lonDeg })).toBeCloseTo(180, 6)
  })

  it('reads east and west over a short hop', () => {
    expect(bearingDeg(ORIGIN, { latDeg: ORIGIN.latDeg, lonDeg: ORIGIN.lonDeg + 0.001 })).toBeCloseTo(90, 3)
    expect(bearingDeg(ORIGIN, { latDeg: ORIGIN.latDeg, lonDeg: ORIGIN.lonDeg - 0.001 })).toBeCloseTo(270, 3)
  })

  it('bows poleward over a long east-west leg, as a great circle must', () => {
    // Same latitude is a rhumb line, not a great circle: in the northern
    // hemisphere the shortest path starts north of due east.
    const farEast = bearingDeg(ORIGIN, { latDeg: ORIGIN.latDeg, lonDeg: ORIGIN.lonDeg + 1 })

    expect(farEast).toBeLessThan(90)
    expect(farEast).toBeGreaterThan(89)
  })

  it('never returns a negative bearing', () => {
    const southWest = { latDeg: ORIGIN.latDeg - 0.5, lonDeg: ORIGIN.lonDeg - 0.5 }
    const result = bearingDeg(ORIGIN, southWest)

    expect(result).toBeGreaterThan(180)
    expect(result).toBeLessThan(270)
  })
})
