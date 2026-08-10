/**
 * Video stream health, as pure folds over whatever an adapter can observe.
 *
 * Deliberately transport-agnostic and DOM-free: a WebRTC adapter reports frames
 * and bytes from `getStats()`, an MJPEG adapter counts image loads, a file
 * adapter reads `getVideoPlaybackQuality()`. They report the same shape, and
 * fields an adapter genuinely cannot know stay `null` rather than being faked.
 */

export type VideoConnectionState = 'idle' | 'connecting' | 'playing' | 'stalled' | 'error'

/** One observation from an adapter. Fields it cannot measure are omitted. */
export interface VideoStatsSample {
  timestampMs: number
  /** Monotonic count since the stream started. */
  framesDecoded: number
  droppedFrames?: number
  bytesReceived?: number
}

export interface VideoHealth {
  connectionState: VideoConnectionState
  /** Null until two samples exist — a rate needs an interval. */
  fps: number | null
  bitrateKbps: number | null
  framesDecoded: number
  droppedFrames: number | null
  /** How long since a frame actually arrived; drives stall detection. */
  lastFrameAgeMs: number | null
  reconnectCount: number
}

export interface VideoHealthState {
  health: VideoHealth
  /** Retained so the next sample can difference against it. */
  lastSample: VideoStatsSample | null
}

export interface VideoHealthConfig {
  /** No new frames for this long means stalled, not merely slow. */
  stallAfterMs: number
  /** Smoothing on fps and bitrate; 1 disables it. */
  smoothing: number
}

export const DEFAULT_VIDEO_HEALTH_CONFIG: VideoHealthConfig = {
  stallAfterMs: 2000,
  smoothing: 0.3,
}

export const IDLE_VIDEO_HEALTH: VideoHealth = {
  connectionState: 'idle',
  fps: null,
  bitrateKbps: null,
  framesDecoded: 0,
  droppedFrames: null,
  lastFrameAgeMs: null,
  reconnectCount: 0,
}

export const EMPTY_VIDEO_HEALTH_STATE: VideoHealthState = {
  health: IDLE_VIDEO_HEALTH,
  lastSample: null,
}

/** Exponential smoothing; the first reading is taken as-is. */
function smooth(previous: number | null, next: number, factor: number): number {
  return previous === null ? next : previous + (next - previous) * factor
}

/**
 * Fold one observation into the running health.
 *
 * A sample whose frame count has not advanced still updates the clock, which is
 * what lets a stall be distinguished from a stream that simply has not been
 * polled recently.
 */
export function foldVideoHealth(
  previous: VideoHealthState,
  sample: VideoStatsSample,
  config: VideoHealthConfig = DEFAULT_VIDEO_HEALTH_CONFIG,
): VideoHealthState {
  const last = previous.lastSample
  const elapsedMs = last === null ? 0 : sample.timestampMs - last.timestampMs
  const frameDelta = last === null ? 0 : sample.framesDecoded - last.framesDecoded

  // Out-of-order or duplicate timestamps would divide by zero or go negative.
  const canRate = last !== null && elapsedMs > 0

  const fps = canRate
    ? smooth(previous.health.fps, (frameDelta * 1000) / elapsedMs, config.smoothing)
    : previous.health.fps

  const byteDelta = canRate && sample.bytesReceived !== undefined && last?.bytesReceived !== undefined
    ? sample.bytesReceived - last.bytesReceived
    : null

  const bitrateKbps = byteDelta === null
    ? previous.health.bitrateKbps
    : smooth(previous.health.bitrateKbps, (byteDelta * 8) / elapsedMs, config.smoothing)

  // Age is measured from the last sample that actually advanced the frame count.
  const lastFrameAgeMs = frameDelta > 0 || last === null
    ? 0
    : (previous.health.lastFrameAgeMs ?? 0) + elapsedMs

  const stalled = lastFrameAgeMs >= config.stallAfterMs

  /*
   * Never having received a frame is not the same as having stopped receiving
   * them. Until one arrives the adapter's own state stands — 'connecting' while
   * waiting, 'error' if the transport already failed — because reporting
   * 'stalled' would imply a stream that was once running.
   */
  const everDecoded = sample.framesDecoded > 0
  const connectionState = everDecoded
    ? (stalled ? 'stalled' : 'playing')
    : previous.health.connectionState

  return {
    lastSample: sample,
    health: {
      connectionState,
      fps,
      bitrateKbps,
      framesDecoded: sample.framesDecoded,
      droppedFrames: sample.droppedFrames ?? previous.health.droppedFrames,
      lastFrameAgeMs,
      reconnectCount: previous.health.reconnectCount,
    },
  }
}

/** Connection transitions the adapter reports directly, outside the stats path. */
export function setVideoConnectionState(
  previous: VideoHealthState,
  connectionState: VideoConnectionState,
): VideoHealthState {
  // A reconnect resets the frame baseline: counters restart at zero on the new
  // stream, and differencing across that boundary would read as a huge negative.
  const reconnecting = connectionState === 'connecting' && previous.health.connectionState !== 'idle'

  return {
    lastSample: reconnecting ? null : previous.lastSample,
    health: {
      ...previous.health,
      connectionState,
      reconnectCount: previous.health.reconnectCount + (reconnecting ? 1 : 0),
      ...(reconnecting ? { fps: null, bitrateKbps: null, lastFrameAgeMs: null } : {}),
    },
  }
}
