/**
 * Bounded breadcrumb trail in geographic coordinates.
 *
 * Pure fold in the shape of the HUD's position resolver: the caller passes the
 * previous state and gets back the next one, so the buffer lives in the adapter.
 */

import { distanceM, type LatLon } from './geodesy'

export interface TrackPoint extends LatLon {
  timestampMs: number
}

export interface TrackConfig {
  /** Hard cap on retained points, bounding memory and render cost. */
  maxPoints: number
  /** Rolling window; points older than this are dropped. */
  maxAgeMs: number
  /**
   * Minimum ground distance before a new point is recorded. Without this a
   * parked vehicle fills the buffer with identical points — the bridge emits
   * five messages per tick, so an unguarded trail stores five duplicates each time.
   */
  minSpacingM: number
}

export const DEFAULT_TRACK_CONFIG: TrackConfig = {
  maxPoints: 1000,
  maxAgeMs: 300000,
  minSpacingM: 1,
}

export interface TrackState {
  points: TrackPoint[]
}

export interface TrackStepResult {
  state: TrackState
  /** Whether this fix was recorded, or rejected as too close to the last one. */
  appended: boolean
}

export const EMPTY_TRACK: TrackState = { points: [] }

function prune(points: TrackPoint[], newestMs: number, config: TrackConfig): TrackPoint[] {
  const cutoffMs = newestMs - config.maxAgeMs
  const fresh = points.filter((point) => point.timestampMs >= cutoffMs)

  return fresh.length > config.maxPoints ? fresh.slice(fresh.length - config.maxPoints) : fresh
}

/**
 * Append a fix, then bound the trail by age and count. Returns a new state; the
 * previous one is never mutated.
 */
export function appendTrackPoint(
  previous: TrackState | null,
  fix: TrackPoint,
  config: TrackConfig = DEFAULT_TRACK_CONFIG,
): TrackStepResult {
  const points = previous?.points ?? []
  const last = points[points.length - 1]

  if (last !== undefined && distanceM(last, fix) < config.minSpacingM) {
    // Still prune: a stationary vehicle should age its trail out, not freeze it.
    return { state: { points: prune(points, fix.timestampMs, config) }, appended: false }
  }

  return { state: { points: prune([...points, fix], fix.timestampMs, config) }, appended: true }
}

/** Total ground distance along the retained trail, in metres. */
export function trackLengthM(state: TrackState): number {
  let total = 0

  for (let index = 1; index < state.points.length; index += 1) {
    total += distanceM(state.points[index - 1], state.points[index])
  }

  return total
}
