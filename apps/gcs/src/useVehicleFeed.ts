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
  appendLogEntry,
  appendTrackPoint,
  hasFix,
  mergeVehicleState,
  startTelemetryStream,
  systemKey,
  toDecodeErrorEntry,
  toLogEntry,
  type ConnectionState,
  type LogEntry,
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
  /** Recent raw messages, newest last. Published on a timer, not per frame. */
  log: LogEntry[]
}

/** The log is published on its own timer, so it is held as separate state. */
type FeedSnapshot = Omit<VehicleFeedState, 'log'>

const INITIAL: FeedSnapshot = {
  vehicle: null,
  track: [],
  enuTrack: [],
  sample: null,
  connectionState: 'connecting',
  frameCount: 0,
  decodeErrorCount: 0,
  knownSystems: [],
}

/** Matches the hud harness's live-source window. */
const ENU_TRACK_MAX_POINTS = 600
const LOG_MAX_ENTRIES = 500
/**
 * The log publishes on a timer rather than per frame. Frames arrive at ~33 Hz and
 * the list is hundreds of rows, so appending per frame would re-diff the whole
 * table faster than anyone can read it.
 */
const LOG_PUBLISH_MS = 150
/**
 * Per-system state is bounded per system (600 ENU points, a capped trail, one
 * sample) but the number of *systems* was not. Anything cycling sysIds — a
 * misconfigured relay, a replay of several flights — would accumulate buffers
 * forever on a long-running kiosk. Drop a system's state once it goes quiet;
 * the bridge already does the same for its own roster.
 */
const SYSTEM_TTL_MS = 60000
const SYSTEM_SWEEP_MS = 5000

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
  const [snapshot, setSnapshot] = useState<FeedSnapshot>(INITIAL)
  const [log, setLog] = useState<LogEntry[]>([])

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
    let logEntries: LogEntry[] = []
    let logDirty = false
    let nextLogId = 1

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
          logEntries = appendLogEntry(logEntries, toLogEntry(nextLogId++, frame), LOG_MAX_ENTRIES)
          logDirty = true

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
          logEntries = appendLogEntry(logEntries, toDecodeErrorEntry(nextLogId++, Date.now()), LOG_MAX_ENTRIES)
          logDirty = true
        },
      },
    )

    const logTimer = setInterval(() => {
      if (!logDirty) {
        return
      }

      logDirty = false
      setLog(logEntries)
    }, LOG_PUBLISH_MS)

    const sweepTimer = setInterval(() => {
      const staleBeforeMs = Date.now() - SYSTEM_TTL_MS

      vehicles.forEach((vehicle, key) => {
        if (vehicle.lastUpdateMs >= staleBeforeMs) {
          return
        }

        vehicles.delete(key)
        tracks.delete(key)
        origins.delete(key)
        positions.delete(key)
        enuTracks.delete(key)
      })
    }, SYSTEM_SWEEP_MS)

    return () => {
      clearInterval(logTimer)
      clearInterval(sweepTimer)
      stop()
      setSnapshot(INITIAL)
      setLog([])
    }
  }, [url, trackConfig])

  return { ...snapshot, log }
}
