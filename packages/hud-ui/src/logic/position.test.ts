import { describe, expect, it } from 'vitest'
import {
  projectLlaToEnu,
  resolvePositionStep,
  resolveTrack,
  type GeoOrigin,
  type PositionState,
} from './position'
import type { TelemetrySample } from './telemetry'

const ORIGIN: GeoOrigin = { latDegE7: 473000000, lonDegE7: 85000000, altMm: 500000 }

describe('projectLlaToEnu', () => {
  it('projects the origin itself to (0,0,0)', () => {
    const point = projectLlaToEnu(ORIGIN.latDegE7, ORIGIN.lonDegE7, ORIGIN.altMm, ORIGIN)
    expect(point.eastM).toBeCloseTo(0, 9)
    expect(point.northM).toBeCloseTo(0, 9)
    expect(point.upM).toBeCloseTo(0, 9)
  })

  it('maps +0.001° latitude to ~111.3195 m north, zero east', () => {
    const point = projectLlaToEnu(ORIGIN.latDegE7 + 10000, ORIGIN.lonDegE7, ORIGIN.altMm, ORIGIN)
    expect(point.northM).toBeCloseTo(111.3195, 3)
    expect(point.eastM).toBeCloseTo(0, 9)
  })

  it('scales +0.001° longitude by cos(lat0): ~55.6597 m east at lat0=60°', () => {
    const origin60: GeoOrigin = { latDegE7: 600000000, lonDegE7: 0, altMm: 0 }
    const point = projectLlaToEnu(origin60.latDegE7, 10000, 0, origin60)
    expect(point.eastM).toBeCloseTo(55.6597, 3)
    expect(point.northM).toBeCloseTo(0, 9)
  })

  it('maps +1000 mm altitude to +1 m up', () => {
    const point = projectLlaToEnu(ORIGIN.latDegE7, ORIGIN.lonDegE7, ORIGIN.altMm + 1000, ORIGIN)
    expect(point.upM).toBeCloseTo(1, 9)
  })
})

describe('resolvePositionStep — velocity fallback', () => {
  const velocitySample = (timestampMs: number): TelemetrySample => ({
    timestampMs,
    globalPositionInt: { vxCms: 1000, vyCms: 500, vzCms: -200 },
  })

  it('anchors the first velocity-only sample at (0,0,0) and reports the integrated source', () => {
    const result = resolvePositionStep(null, velocitySample(0), null)
    expect(result.point).toMatchObject({ eastM: 0, northM: 0, upM: 0, tSec: 0 })
    expect(result.point.source).toBe('GLOBAL_POSITION_INT.vxvy_vz_integrated')
  })

  it('integrates NED velocity over dt, flipping vz (+down) to up', () => {
    const first = resolvePositionStep(null, velocitySample(0), null)
    const second = resolvePositionStep(first.state, velocitySample(1000), null)

    // vx=10 m/s North, vy=5 m/s East, vz=-2 m/s → +2 m/s up, over 1 s.
    expect(second.point.northM).toBeCloseTo(10, 6)
    expect(second.point.eastM).toBeCloseTo(5, 6)
    expect(second.point.upM).toBeCloseTo(2, 6)
    expect(second.point.tSec).toBeCloseTo(1, 6)
  })

  it('does not advance on non-positive dt (out-of-order timestamps)', () => {
    const prev: PositionState = {
      point: { eastM: 5, northM: 10, upM: 2 },
      tSec: 1,
      lastTimestampMs: 1000,
    }
    const result = resolvePositionStep(prev, velocitySample(500), null)
    expect(result.point).toMatchObject({ eastM: 5, northM: 10, upM: 2, tSec: 1 })
  })
})

describe('resolvePositionStep — source selection', () => {
  it('prefers the absolute LLA→ENU path when an origin is locked and lat/lon present', () => {
    const sample: TelemetrySample = {
      timestampMs: 0,
      globalPositionInt: {
        latDegE7: ORIGIN.latDegE7 + 10000,
        lonDegE7: ORIGIN.lonDegE7,
        altMm: ORIGIN.altMm,
        vxCms: 1000,
        vyCms: 500,
      },
    }
    const result = resolvePositionStep(null, sample, ORIGIN)
    expect(result.point.source).toBe('GLOBAL_POSITION_INT.lla_enu')
    expect(result.point.northM).toBeCloseTo(111.3195, 3)
  })

  it('reports source "none" when neither position nor velocity is available', () => {
    const sample: TelemetrySample = { timestampMs: 0, attitude: { rollRad: 0.1 } }
    const result = resolvePositionStep(null, sample, ORIGIN)
    expect(result.point.source).toBe('none')
    expect(result.point).toMatchObject({ eastM: 0, northM: 0, upM: 0 })
  })
})

describe('resolveTrack', () => {
  it('captures the origin at the first absolute fix so the track starts at (0,0,0)', () => {
    const samples: TelemetrySample[] = [
      {
        timestampMs: 0,
        globalPositionInt: { latDegE7: ORIGIN.latDegE7, lonDegE7: ORIGIN.lonDegE7, altMm: ORIGIN.altMm },
      },
      {
        timestampMs: 1000,
        globalPositionInt: {
          latDegE7: ORIGIN.latDegE7 + 10000,
          lonDegE7: ORIGIN.lonDegE7,
          altMm: ORIGIN.altMm + 1000,
        },
      },
    ]
    const track = resolveTrack(samples)
    expect(track).toHaveLength(2)
    expect(track[0]).toMatchObject({ eastM: 0, northM: 0, upM: 0, source: 'GLOBAL_POSITION_INT.lla_enu' })
    expect(track[1].northM).toBeCloseTo(111.3195, 3)
    expect(track[1].upM).toBeCloseTo(1, 6)
  })

  it('dead-reckons a pure-velocity stream from (0,0,0)', () => {
    const samples: TelemetrySample[] = [
      { timestampMs: 0, globalPositionInt: { vxCms: 1000, vyCms: 0, vzCms: 0 } },
      { timestampMs: 1000, globalPositionInt: { vxCms: 1000, vyCms: 0, vzCms: 0 } },
      { timestampMs: 2000, globalPositionInt: { vxCms: 1000, vyCms: 0, vzCms: 0 } },
    ]
    const track = resolveTrack(samples)
    expect(track[0].northM).toBeCloseTo(0, 6)
    expect(track[2].northM).toBeCloseTo(20, 6)
    expect(track.every((p) => p.source === 'GLOBAL_POSITION_INT.vxvy_vz_integrated')).toBe(true)
  })
})
