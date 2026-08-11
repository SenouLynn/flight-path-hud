import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMockLiveSample,
  buildSyntheticMissionSamples,
  createLiveMockSource,
  createSyntheticReplaySource,
} from './telemetrySource'
import { resolveTrack } from '@flight-path-hud/hud-ui'

describe('buildMockLiveSample', () => {
  it('produces finite telemetry values for all required fields', () => {
    const sample = buildMockLiveSample(123456)

    expect(sample.timestampMs).toBe(123456)
    expect(sample.attitude?.rollRad).toBeTypeOf('number')
    expect(sample.attitude?.pitchRad).toBeTypeOf('number')
    expect(sample.vfrHud?.headingDeg).toBeTypeOf('number')
    expect(sample.globalPositionInt?.vxCms).toBeTypeOf('number')
    expect(sample.globalPositionInt?.vyCms).toBeTypeOf('number')
    expect(sample.globalPositionInt?.vzCms).toBeTypeOf('number')
    expect(sample.gpsRawInt?.cogCdeg).toBeTypeOf('number')
  })
})

describe('buildSyntheticMissionSamples', () => {
  it('stamps every frame with an absolute lat/lon/alt fix', () => {
    const samples = buildSyntheticMissionSamples(40, 180)
    expect(samples).toHaveLength(40)
    for (const sample of samples) {
      expect(sample.globalPositionInt?.latDegE7).toBeTypeOf('number')
      expect(sample.globalPositionInt?.lonDegE7).toBeTypeOf('number')
      expect(sample.globalPositionInt?.altMm).toBeTypeOf('number')
    }
  })

  it('round-trips: resolveTrack reconstructs the integrated ENU path (to degE7 quantization)', () => {
    const samples = buildSyntheticMissionSamples(40, 180)
    const track = resolveTrack(samples)

    // Track anchors at the origin and reports the absolute (GPS) source.
    expect(track[0]).toMatchObject({ eastM: 0, northM: 0, upM: 0 })
    expect(track.every((p) => p.source === 'GLOBAL_POSITION_INT.lla_enu')).toBe(true)

    // Re-integrate the same velocities to get the ground-truth ENU path and
    // confirm the LLA round-trip reproduces it within int32 degE7 resolution.
    const dtSec = 180 / 1000
    let eastM = 0
    let northM = 0
    let upM = 0
    samples.forEach((sample, index) => {
      const gp = sample.globalPositionInt!
      if (index > 0) {
        northM += ((gp.vxCms ?? 0) / 100) * dtSec
        eastM += ((gp.vyCms ?? 0) / 100) * dtSec
        upM += (-(gp.vzCms ?? 0) / 100) * dtSec
      }
      expect(track[index].northM).toBeCloseTo(northM, 1)
      expect(track[index].eastM).toBeCloseTo(eastM, 1)
      expect(track[index].upM).toBeCloseTo(upM, 2)
    })
  })
})

describe('createSyntheticReplaySource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('emits replay samples immediately and on interval', () => {
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockReturnValue(5000)

    const source = createSyntheticReplaySource(
      [
        { timestampMs: 0, vfrHud: { headingDeg: 90 } },
        { timestampMs: 0, vfrHud: { headingDeg: 180 } },
      ],
      200,
    )

    const seen: number[] = []
    const stop = source.start((sample) => {
      const heading = sample.vfrHud?.headingDeg
      if (heading !== undefined) {
        seen.push(heading)
      }
    })

    expect(seen).toEqual([90])

    vi.advanceTimersByTime(400)
    expect(seen).toEqual([90, 180, 90])

    stop()
    vi.advanceTimersByTime(400)
    expect(seen).toEqual([90, 180, 90])
  })
})

describe('createLiveMockSource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('emits samples repeatedly with monotonic timestamps', () => {
    vi.useFakeTimers()

    const source = createLiveMockSource(100)
    const timestamps: number[] = []
    const stop = source.start((sample) => {
      timestamps.push(sample.timestampMs)
    })

    vi.advanceTimersByTime(300)
    stop()

    expect(timestamps.length).toBeGreaterThanOrEqual(3)
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeGreaterThanOrEqual(timestamps[index - 1])
    }
  })
})
