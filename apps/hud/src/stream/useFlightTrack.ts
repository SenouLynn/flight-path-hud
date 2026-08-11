import { useEffect, useRef, useState } from 'react'
import {
  originFromSample,
  resolvePositionStep,
  type GeoOrigin,
  type PositionSource,
  type PositionState,
  type TrackPoint,
} from '@flight-path-hud/hud-ui'
import type { TelemetryFeedState } from './useTelemetryFeed'

export interface FlightTrackConfig {
  /** Hard cap on retained points (bounds memory + SVG size). */
  maxPoints: number
  /**
   * Optional rolling age window in seconds. Undefined = keep the full track up
   * to `maxPoints` (finite/replay sources); set it for open-ended live feeds.
   */
  maxAgeSec?: number
}

export interface FlightTrackState {
  track: TrackPoint[]
  source: PositionSource
}

interface Snapshot extends FlightTrackState {
  /** The source this snapshot was accumulated from — used to guard stale reads. */
  sourceId: string
}

const EMPTY: FlightTrackState = { track: [], source: 'none' }

/**
 * Accumulate a bounded breadcrumb track from the shared telemetry feed. This is
 * the one stateful layer over the pure `resolvePositionStep` fold: it owns the
 * ring buffer, the captured ENU origin, and the running integrator state in
 * refs, and publishes an immutable snapshot for rendering.
 *
 * - StrictMode / duplicate renders: appends are gated on the feed's monotonic
 *   `packetCount`, so a re-run with the same packet is a no-op.
 * - Source switch (`sourceId` change): buffer, origin, and integrator reset so
 *   the new stream starts a fresh track at its own origin.
 */
export function useFlightTrack(
  feed: TelemetryFeedState,
  sourceId: string,
  config: FlightTrackConfig,
): FlightTrackState {
  const originRef = useRef<GeoOrigin | null>(null)
  const stateRef = useRef<PositionState | null>(null)
  const bufferRef = useRef<TrackPoint[]>([])
  const lastPacketRef = useRef(0)
  const [snapshot, setSnapshot] = useState<Snapshot>({ ...EMPTY, sourceId })

  const { latestSample, packetCount } = feed
  const { maxPoints, maxAgeSec } = config

  // Reset the accumulator when the active source changes. Refs may be mutated
  // in effects (unlike during render); the displayed snapshot is cleared via
  // the stale-source guard on the return value below.
  useEffect(() => {
    originRef.current = null
    stateRef.current = null
    bufferRef.current = []
    lastPacketRef.current = 0
  }, [sourceId])

  useEffect(() => {
    if (latestSample === null || packetCount <= lastPacketRef.current) {
      return
    }
    lastPacketRef.current = packetCount

    if (originRef.current === null) {
      originRef.current = originFromSample(latestSample)
    }

    const result = resolvePositionStep(stateRef.current, latestSample, originRef.current)
    stateRef.current = result.state

    let next = [...bufferRef.current, result.point]
    if (maxAgeSec !== undefined) {
      const newestTSec = result.point.tSec
      next = next.filter((point) => newestTSec - point.tSec <= maxAgeSec)
    }
    if (next.length > maxPoints) {
      next = next.slice(next.length - maxPoints)
    }

    bufferRef.current = next
    setSnapshot({ track: next, source: result.point.source, sourceId })
  }, [latestSample, packetCount, sourceId, maxPoints, maxAgeSec])

  // Guard against a stale snapshot from the previous source (the reset effect
  // runs post-commit, so this render still holds the old track otherwise).
  return snapshot.sourceId === sourceId
    ? { track: snapshot.track, source: snapshot.source }
    : EMPTY
}
