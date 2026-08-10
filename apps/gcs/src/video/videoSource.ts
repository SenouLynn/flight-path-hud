/**
 * The video ingress port, on the consumer side.
 *
 * Lives here rather than in gcs-core because mounting a stream is unavoidably a
 * DOM act, and the core stays DOM-free. What *is* shared is the health shape:
 * every adapter reports `VideoStatsSample`, and gcs-core folds it identically.
 *
 * Adapters are per **protocol**, not per camera. Camera type, capture device and
 * encoding are upstream concerns the GCS never learns about — but the delivery
 * protocol genuinely reaches this layer, because it decides which element the
 * frames land in and which statistics exist at all.
 */

import type { VideoConnectionState, VideoStatsSample } from '@flight-path-hud/gcs-core'

export interface VideoSourceHandlers {
  onStats: (sample: VideoStatsSample) => void
  onConnectionState: (state: VideoConnectionState) => void
}

export interface VideoSource {
  id: string
  label: string
  /** What this adapter can actually measure, so the UI need not guess. */
  measures: { fps: boolean, bitrate: boolean, dropped: boolean }
  /** Mount into the container and start streaming; returns teardown. */
  start: (container: HTMLElement, handlers: VideoSourceHandlers) => () => void
}
