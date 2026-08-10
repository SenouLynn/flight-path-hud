import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_HEALTH_CONFIG,
  EMPTY_VIDEO_HEALTH_STATE,
  foldVideoHealth,
  setVideoConnectionState,
  type VideoHealthState,
} from './video'

// Smoothing off, so the assertions are about the arithmetic rather than the filter.
const CONFIG = { ...DEFAULT_VIDEO_HEALTH_CONFIG, smoothing: 1 }

function feed(samples: Array<{ t: number, frames: number, bytes?: number }>): VideoHealthState {
  return samples.reduce<VideoHealthState>(
    (state, sample) => foldVideoHealth(
      state,
      { timestampMs: sample.t, framesDecoded: sample.frames, bytesReceived: sample.bytes },
      CONFIG,
    ),
    EMPTY_VIDEO_HEALTH_STATE,
  )
}

describe('foldVideoHealth', () => {
  it('reports no rate from a single sample, because a rate needs an interval', () => {
    const state = feed([{ t: 1000, frames: 0 }])

    expect(state.health.fps).toBeNull()
    expect(state.health.bitrateKbps).toBeNull()
  })

  it('computes fps from the frame delta over the interval', () => {
    const state = feed([{ t: 1000, frames: 0 }, { t: 2000, frames: 30 }])

    expect(state.health.fps).toBeCloseTo(30, 6)
  })

  it('computes bitrate in kbps from the byte delta', () => {
    // 125_000 bytes in one second = 1_000_000 bits/s = 1000 kbps.
    const state = feed([{ t: 1000, frames: 0, bytes: 0 }, { t: 2000, frames: 30, bytes: 125000 }])

    expect(state.health.bitrateKbps).toBeCloseTo(1000, 3)
  })

  it('leaves bitrate null when the adapter cannot measure bytes', () => {
    // MJPEG over <img> has no byte counter; faking one would be worse than null.
    const state = feed([{ t: 1000, frames: 0 }, { t: 2000, frames: 30 }])

    expect(state.health.bitrateKbps).toBeNull()
    expect(state.health.fps).toBeCloseTo(30, 6)
  })

  it('accumulates frame age while the count stands still', () => {
    const state = feed([
      { t: 1000, frames: 10 },
      { t: 1500, frames: 10 },
      { t: 1900, frames: 10 },
    ])

    expect(state.health.lastFrameAgeMs).toBe(900)
    expect(state.health.connectionState).toBe('playing')
  })

  it('reports stalled once the age passes the threshold', () => {
    const state = feed([
      { t: 1000, frames: 10 },
      { t: 2000, frames: 10 },
      { t: 3100, frames: 10 },
    ])

    expect(state.health.lastFrameAgeMs).toBe(2100)
    expect(state.health.connectionState).toBe('stalled')
  })

  it('recovers from stalled as soon as a frame lands', () => {
    const stalled = feed([{ t: 1000, frames: 10 }, { t: 4000, frames: 10 }])
    expect(stalled.health.connectionState).toBe('stalled')

    const recovered = foldVideoHealth(stalled, { timestampMs: 4100, framesDecoded: 13 }, CONFIG)

    expect(recovered.health.connectionState).toBe('playing')
    expect(recovered.health.lastFrameAgeMs).toBe(0)
  })

  it('ignores a non-advancing clock rather than dividing by zero', () => {
    const state = feed([{ t: 1000, frames: 0 }, { t: 1000, frames: 5 }])

    expect(Number.isFinite(state.health.fps ?? 0)).toBe(true)
    expect(state.health.fps).toBeNull()
  })

  it('smooths successive readings when smoothing is enabled', () => {
    const smoothed = [
      { timestampMs: 1000, framesDecoded: 0 },
      { timestampMs: 2000, framesDecoded: 30 },
      { timestampMs: 3000, framesDecoded: 40 },
    ].reduce<VideoHealthState>(
      (state, sample) => foldVideoHealth(state, sample, { stallAfterMs: 2000, smoothing: 0.5 }),
      EMPTY_VIDEO_HEALTH_STATE,
    )

    // Raw second reading is 10 fps; halfway from 30 is 20.
    expect(smoothed.health.fps).toBeCloseTo(20, 6)
  })
})

describe('foldVideoHealth — before the first frame', () => {
  it('stays connecting rather than claiming to play', () => {
    // A stats tick is not evidence of a frame; only a frame is.
    const connecting = setVideoConnectionState(EMPTY_VIDEO_HEALTH_STATE, 'connecting')
    const polled = foldVideoHealth(connecting, { timestampMs: 1000, framesDecoded: 0 }, CONFIG)

    expect(polled.health.connectionState).toBe('connecting')
  })

  it('never reports stalled for a stream that never started', () => {
    // 'stalled' implies it was running; a dead URL was never running.
    let state = setVideoConnectionState(EMPTY_VIDEO_HEALTH_STATE, 'connecting')
    for (const t of [1000, 2000, 3000, 9000]) {
      state = foldVideoHealth(state, { timestampMs: t, framesDecoded: 0 }, CONFIG)
    }

    expect(state.health.connectionState).toBe('connecting')
    expect(state.health.framesDecoded).toBe(0)
  })

  it('keeps an error state through polling rather than overwriting it', () => {
    const errored = setVideoConnectionState(EMPTY_VIDEO_HEALTH_STATE, 'error')
    const polled = foldVideoHealth(errored, { timestampMs: 1000, framesDecoded: 0 }, CONFIG)

    expect(polled.health.connectionState).toBe('error')
  })

  it('switches to playing the moment a frame lands', () => {
    const connecting = setVideoConnectionState(EMPTY_VIDEO_HEALTH_STATE, 'connecting')
    const idle = foldVideoHealth(connecting, { timestampMs: 1000, framesDecoded: 0 }, CONFIG)
    const live = foldVideoHealth(idle, { timestampMs: 1500, framesDecoded: 7 }, CONFIG)

    expect(live.health.connectionState).toBe('playing')
  })
})

describe('setVideoConnectionState', () => {
  it('counts a reconnect and drops the stale baseline', () => {
    // Frame counters restart at zero on a new stream, so differencing across the
    // boundary would read as a large negative rate.
    const playing = feed([{ t: 1000, frames: 0 }, { t: 2000, frames: 30 }])
    const reconnecting = setVideoConnectionState(playing, 'connecting')

    expect(reconnecting.health.reconnectCount).toBe(1)
    expect(reconnecting.lastSample).toBeNull()
    expect(reconnecting.health.fps).toBeNull()
  })

  it('does not count the first connect as a reconnect', () => {
    const connecting = setVideoConnectionState(EMPTY_VIDEO_HEALTH_STATE, 'connecting')

    expect(connecting.health.reconnectCount).toBe(0)
    expect(connecting.health.connectionState).toBe('connecting')
  })

  it('keeps the frame total across an error, since the stream is the same one', () => {
    const playing = feed([{ t: 1000, frames: 0 }, { t: 2000, frames: 30 }])
    const errored = setVideoConnectionState(playing, 'error')

    expect(errored.health.connectionState).toBe('error')
    expect(errored.health.framesDecoded).toBe(30)
  })
})
