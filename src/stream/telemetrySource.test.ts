import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMockLiveSample, createLiveMockSource, createSyntheticReplaySource } from './telemetrySource'

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
