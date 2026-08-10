import { describe, expect, it } from 'vitest'
import { appendTrackPoint, trackLengthM, type TrackConfig, type TrackState } from './track'

const CONFIG: TrackConfig = { maxPoints: 5, maxAgeMs: 10000, minSpacingM: 2 }
const BASE = { latDeg: 47.397742, lonDeg: 8.545594 }

/** ~1.11 m per 1e-5 degrees of latitude, so this is a convenient metres knob. */
function northOf(metres: number, timestampMs: number) {
  return { latDeg: BASE.latDeg + metres / 111195, lonDeg: BASE.lonDeg, timestampMs }
}

function build(points: Array<{ metres: number, timestampMs: number }>, config = CONFIG): TrackState {
  let state: TrackState | null = null
  for (const point of points) {
    state = appendTrackPoint(state, northOf(point.metres, point.timestampMs), config).state
  }
  return state ?? { points: [] }
}

describe('appendTrackPoint', () => {
  it('records the first fix', () => {
    const result = appendTrackPoint(null, northOf(0, 1000), CONFIG)

    expect(result.appended).toBe(true)
    expect(result.state.points).toHaveLength(1)
  })

  it('rejects a fix closer than the minimum spacing', () => {
    const first = appendTrackPoint(null, northOf(0, 1000), CONFIG)
    const second = appendTrackPoint(first.state, northOf(0.5, 1100), CONFIG)

    expect(second.appended).toBe(false)
    expect(second.state.points).toHaveLength(1)
  })

  it('records a fix once it clears the minimum spacing', () => {
    const first = appendTrackPoint(null, northOf(0, 1000), CONFIG)
    const second = appendTrackPoint(first.state, northOf(5, 1100), CONFIG)

    expect(second.appended).toBe(true)
    expect(second.state.points).toHaveLength(2)
  })

  it('does not grow the trail when a vehicle sits still and repeats its fix', () => {
    // The bridge sends five messages per tick, so an unguarded trail would take
    // five identical points every 150ms.
    let state: TrackState | null = null
    for (let index = 0; index < 25; index += 1) {
      state = appendTrackPoint(state, northOf(0, 1000 + index * 30), CONFIG).state
    }

    expect(state?.points).toHaveLength(1)
  })

  it('caps the trail at maxPoints, keeping the newest', () => {
    const state = build([0, 10, 20, 30, 40, 50, 60].map((metres, index) => ({
      metres,
      timestampMs: 1000 + index * 100,
    })))

    expect(state.points).toHaveLength(5)
    expect(state.points[state.points.length - 1].timestampMs).toBe(1600)
  })

  it('drops points older than maxAgeMs', () => {
    const state = build([
      { metres: 0, timestampMs: 1000 },
      { metres: 10, timestampMs: 5000 },
      { metres: 20, timestampMs: 20000 },
    ])

    expect(state.points).toHaveLength(1)
    expect(state.points[0].timestampMs).toBe(20000)
  })

  it('still ages the trail out while the vehicle is stationary', () => {
    const moving = build([
      { metres: 0, timestampMs: 1000 },
      { metres: 10, timestampMs: 2000 },
    ])
    // A repeated fix far later: rejected as too close, but the old point must expire.
    const later = appendTrackPoint(moving, northOf(10, 30000), CONFIG)

    expect(later.appended).toBe(false)
    expect(later.state.points).toHaveLength(0)
  })

  it('returns the identical state when nothing was added or expired', () => {
    // Renderers skip redrawing on identity, and at ~33 frames/s with a spacing
    // guard most frames add nothing — reallocating would redraw the whole
    // polyline anyway.
    const first = appendTrackPoint(null, northOf(0, 1000), CONFIG)
    const rejected = appendTrackPoint(first.state, northOf(0.2, 1050), CONFIG)

    expect(rejected.appended).toBe(false)
    expect(rejected.state).toBe(first.state)
  })

  it('still returns fresh state when a rejected fix ages others out', () => {
    const built = build([
      { metres: 0, timestampMs: 1000 },
      { metres: 10, timestampMs: 2000 },
    ])
    const later = appendTrackPoint(built, northOf(10, 30000), CONFIG)

    expect(later.state).not.toBe(built)
    expect(later.state.points).toHaveLength(0)
  })

  it('does not mutate the previous state', () => {
    const first = appendTrackPoint(null, northOf(0, 1000), CONFIG)
    const before = first.state.points.length
    appendTrackPoint(first.state, northOf(10, 1100), CONFIG)

    expect(first.state.points).toHaveLength(before)
  })
})

describe('trackLengthM', () => {
  it('is zero for an empty or single-point trail', () => {
    expect(trackLengthM({ points: [] })).toBe(0)
    expect(trackLengthM(build([{ metres: 0, timestampMs: 1000 }]))).toBe(0)
  })

  it('sums the leg distances', () => {
    const state = build([
      { metres: 0, timestampMs: 1000 },
      { metres: 10, timestampMs: 1100 },
      { metres: 20, timestampMs: 1200 },
    ])

    expect(trackLengthM(state)).toBeCloseTo(20, 1)
  })
})
