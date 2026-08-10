/**
 * React adapter over the gcs-core folds.
 *
 * The core is pure — it takes previous state and returns the next. This hook is
 * where the accumulation lives: refs hold the running folds, and a snapshot is
 * published to state for rendering. Same split as the HUD's useFlightTrack.
 */

import {
  DEFAULT_TRACK_CONFIG,
  EMPTY_TRACK,
  appendTrackPoint,
  hasFix,
  mergeVehicleState,
  startTelemetryStream,
  systemKey,
  type ConnectionState,
  type SocketLike,
  type TrackConfig,
  type TrackPoint,
  type TrackState,
  type VehicleState,
} from '@flight-path-hud/gcs-core'
import {
  originFromSample,
  resolvePositionStep,
  type GeoOrigin,
  type PositionState,
  type TelemetrySample,
  type TrackPoint as EnuTrackPoint,
} from '@flight-path-hud/hud-ui'
import { useEffect, useRef, useState } from 'react'

/**
 * The browser's WebSocket, adapted to the core's transport-agnostic shape. This
 * is the only place the GCS app assumes a DOM socket — a Node or Pi host would
 * pass its own factory instead.
 */
function browserSocketFactory(url: string): SocketLike {
  const socket = new WebSocket(url)

  return {
    addEventListener: (event, handler) => socket.addEventListener(event, handler),
    removeEventListener: (event, handler) => socket.removeEventListener(event, handler),
    close: () => socket.close(),
  }
}

export interface VehicleFeedState {
  vehicle: VehicleState | null
  /** Geographic trail for the map. */
  track: TrackPoint[]
  /** Local ENU trail, for the HUD's flight-path recorder. */
  enuTrack: EnuTrackPoint[]
  /** Merged sample for the HUD instruments. */
  sample: TelemetrySample | null
  connectionState: ConnectionState
  frameCount: number
  decodeErrorCount: number
  /** Every system seen on the link, so a multi-vehicle stream is visible. */
  knownSystems: string[]
}

const INITIAL: VehicleFeedState = {
  vehicle: null,
  track: [],
  enuTrack: [],
  sample: null,
  connectionState: 'connecting',
  frameCount: 0,
  decodeErrorCount: 0,
  knownSystems: [],
}

/** Matches the web harness's live-source window. */
const ENU_TRACK_MAX_POINTS = 600

export interface VehicleFeedOptions {
  url: string
  /** Which system to display. Null follows whichever system reported last. */
  selectedSystem?: string | null
  trackConfig?: TrackConfig
}

export function useVehicleFeed({
  url,
  selectedSystem = null,
  trackConfig = DEFAULT_TRACK_CONFIG,
}: VehicleFeedOptions): VehicleFeedState {
  const [snapshot, setSnapshot] = useState<VehicleFeedState>(INITIAL)

  // Read the selection per frame so changing it never tears down the socket.
  const selectedRef = useRef(selectedSystem)
  useEffect(() => {
    selectedRef.current = selectedSystem
  }, [selectedSystem])

  useEffect(() => {
    // Per-system folds: two vehicles must never merge into one aircraft.
    const vehicles = new Map<string, VehicleState>()
    const tracks = new Map<string, TrackState>()
    // ENU accumulation for the HUD recorder, reusing hud-ui's pure position fold.
    const origins = new Map<string, GeoOrigin | null>()
    const positions = new Map<string, PositionState>()
    const enuTracks = new Map<string, EnuTrackPoint[]>()
    let frameCount = 0
    let decodeErrorCount = 0
    let connectionState: ConnectionState = 'connecting'

    const publish = (activeKey: string) => {
      const vehicle = vehicles.get(activeKey) ?? null
      setSnapshot({
        vehicle,
        track: (tracks.get(activeKey) ?? EMPTY_TRACK).points,
        enuTrack: enuTracks.get(activeKey) ?? [],
        sample: vehicle?.sample ?? null,
        connectionState,
        frameCount,
        decodeErrorCount,
        knownSystems: [...vehicles.keys()].sort(),
      })
    }

    const stop = startTelemetryStream(
      { url, socketFactory: browserSocketFactory },
      {
        onFrame: (frame) => {
          frameCount += 1

          const key = systemKey(frame.sysId, frame.compId)
          const vehicle = mergeVehicleState(vehicles.get(key) ?? null, frame)
          vehicles.set(key, vehicle)

          if (hasFix(vehicle)) {
            const step = appendTrackPoint(
              tracks.get(key) ?? null,
              { latDeg: vehicle.latDeg, lonDeg: vehicle.lonDeg, timestampMs: frame.recvTimestampMs },
              trackConfig,
            )
            tracks.set(key, step.state)

            // Origin is captured lazily at the first absolute fix, same as the harness.
            if (!origins.has(key)) {
              origins.set(key, originFromSample(vehicle.sample))
            }

            const enuStep = resolvePositionStep(
              positions.get(key) ?? null,
              vehicle.sample,
              origins.get(key) ?? null,
            )
            positions.set(key, enuStep.state)

            const points = [...(enuTracks.get(key) ?? []), enuStep.point]
            enuTracks.set(key, points.length > ENU_TRACK_MAX_POINTS
              ? points.slice(points.length - ENU_TRACK_MAX_POINTS)
              : points)
          }

          const selected = selectedRef.current
          // Unselected means "follow the latest reporter", so only republish for
          // the system actually on screen.
          if (selected === null || selected === key) {
            publish(selected ?? key)
          }
        },
        onConnectionState: (state) => {
          connectionState = state
          setSnapshot((previous) => ({ ...previous, connectionState: state }))
        },
        onDecodeError: () => {
          decodeErrorCount += 1
        },
      },
    )

    return () => {
      stop()
      setSnapshot(INITIAL)
    }
  }, [url, trackConfig])

  return snapshot
}
