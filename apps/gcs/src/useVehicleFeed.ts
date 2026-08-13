/**
 * React adapter over the gcs-core folds.
 *
 * The core is pure — it takes previous state and returns the next. This hook is
 * where the accumulation lives: refs hold the running folds, and a snapshot is
 * published to state for rendering. Same split as the HUD's useFlightTrack.
 */

import {
  DEFAULT_TRACK_CONFIG,
  EMPTY_MISSION,
  EMPTY_TRACK,
  appendLogEntry,
  appendTrackPoint,
  encodeRequestMission,
  hasFix,
  homeFromWireFrame,
  mergeVehicleState,
  missionPlanFromFrame,
  startTelemetryStream,
  summarizeNodes,
  systemKey,
  toDecodeErrorEntry,
  toLogEntry,
  type ConnectionState,
  encodeGuidedRepositionRequest,
  encodeSetGuidedRequest, encodeSetArmedRequest, encodeGuidedTakeoffRequest,
  encodeGuidedLandRequest, type ModeChangeWireFrame, type ArmDisarmWireFrame, type GuidedTakeoffWireFrame,
  type GuidedLandWireFrame,
  type FlightStateWireFrame,
  type GuidedRepositionDraft,
  type GuidedRepositionWireFrame,
  type HomePosition,
  type LogEntry,
  type MissionPlan,
  type NodeSummary,
  type SocketLike,
  type StreamHandle,
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
import { useCallback, useEffect, useRef, useState } from 'react'

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
    send: (data) => socket.send(data),
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
  /** Latest mission plan for the active system. EMPTY_MISSION until requested. */
  mission: MissionPlan
  /**
   * Latest mission plan for *every* system, keyed by `systemKey`. The fleet
   * picture needs all of them at once; `mission` above stays the active system's
   * plan, so the single-node panels are unaffected.
   *
   * Published on mission arrival rather than on the node timer: a plan changes
   * only when the operator asks for one, so copying the map twice a second
   * forever would allocate for nothing.
   */
  missions: ReadonlyMap<string, MissionPlan>
  /** Latest home position for the active system. Null until the bridge reports one. */
  home: HomePosition | null
  /**
   * Null means "the bridge hasn't told us yet" — distinct from false. Reset to null
   * on every reconnect, since the bridge resends `linkMode` fresh on each new
   * connection per the protocol.
   */
  replayMode: boolean | null
  /** Recent raw messages, newest last. Published on a timer, not per frame. */
  log: LogEntry[]
  /**
   * Every node on the link, not just the active one — the transport-neutral view
   * a fleet picture consumes. Derived from the same per-system folds below rather
   * than accumulated separately, and published on a timer (see NODE_PUBLISH_MS).
   */
  nodes: NodeSummary[]
  /** Ask the bridge for the active system's current mission plan. */
  requestMission: (sysId: number, compId: number) => void
  flightState: FlightStateWireFrame | null
  guidedReposition: GuidedRepositionWireFrame | null
  modeChange: ModeChangeWireFrame | null
  armDisarm: ArmDisarmWireFrame | null
  guidedTakeoff: GuidedTakeoffWireFrame | null
  guidedLand: GuidedLandWireFrame | null
  sendGuidedReposition: (sysId: number, compId: number, actor: string, draft: GuidedRepositionDraft) => boolean
  sendSetGuided: (sysId: number, compId: number, actor: string) => boolean
  sendSetArmed: (sysId: number, compId: number, actor: string, arm: boolean) => boolean
  sendGuidedTakeoff: (sysId: number, compId: number, actor: string, altitudeM: number, toleranceM: number) => boolean
  sendGuidedLand: (sysId: number, compId: number, actor: string) => boolean
}

/**
 * The log and the node roster are each published on their own timer, and the
 * per-system mission map on mission arrival, so all three are held as separate
 * state. `requestMission` is a stable callback, not fold-derived state.
 */
type FeedSnapshot = Omit<VehicleFeedState, 'log' | 'nodes' | 'missions' | 'requestMission' | 'sendGuidedReposition' | 'sendSetGuided' | 'sendSetArmed' | 'sendGuidedTakeoff' | 'sendGuidedLand'>

const INITIAL: FeedSnapshot = {
  vehicle: null,
  track: [],
  enuTrack: [],
  sample: null,
  connectionState: 'connecting',
  frameCount: 0,
  decodeErrorCount: 0,
  knownSystems: [],
  mission: EMPTY_MISSION,
  home: null,
  replayMode: null,
  flightState: null,
  guidedReposition: null,
  modeChange: null, armDisarm: null, guidedTakeoff: null, guidedLand: null,
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
 * The node roster publishes on a timer too, for two independent reasons — either
 * on its own would be enough:
 *
 * 1. `publish()` below only fires for the system currently on screen. With a
 *    system explicitly selected, every other node's frames are deliberately
 *    skipped, so a frame-driven roster would be permanently stale for exactly the
 *    nodes a roster exists to show.
 * 2. Staleness is derived from elapsed time, not from arrivals. A node going
 *    quiet has to visibly age — and that is by definition when no frames are
 *    coming in, so nothing frame-driven can express it.
 *
 * Slower than the log's cadence: this is a roster of a handful of rows whose
 * freshness bands are measured in seconds, not a scrolling message list.
 */
const NODE_PUBLISH_MS = 500
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
  const [nodes, setNodes] = useState<NodeSummary[]>([])
  const [missionsByKey, setMissionsByKey] = useState<ReadonlyMap<string, MissionPlan>>(new Map())

  // Read the selection per frame so changing it never tears down the socket.
  const selectedRef = useRef(selectedSystem)
  useEffect(() => {
    selectedRef.current = selectedSystem
  }, [selectedSystem])

  // Held outside the effect so requestMission (called from elsewhere in the tree)
  // can reach the current stream without re-subscribing to it.
  const streamRef = useRef<StreamHandle | null>(null)

  const requestMission = useCallback((sysId: number, compId: number) => {
    const message = encodeRequestMission(sysId, compId)
    if (message !== null) {
      streamRef.current?.send(message)
    }
  }, [])
  const sendGuidedReposition = useCallback((sysId: number, compId: number, actor: string, draft: GuidedRepositionDraft) => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `guided-${Date.now()}-${Math.random().toString(16).slice(2)}`
    return streamRef.current?.send(encodeGuidedRepositionRequest({ requestId, sysId, compId,
      actor, timestampMs: Date.now(), draft })) ?? false
  }, [])
  const requestId = (prefix: string) => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const sendSetGuided = useCallback((sysId: number, compId: number, actor: string) => streamRef.current?.send(encodeSetGuidedRequest({ requestId: requestId('mode'), sysId, compId, actor, timestampMs: Date.now() })) ?? false, [])
  const sendSetArmed = useCallback((sysId: number, compId: number, actor: string, arm: boolean) => streamRef.current?.send(encodeSetArmedRequest({ requestId: requestId('armed'), sysId, compId, actor, timestampMs: Date.now(), arm })) ?? false, [])
  const sendGuidedTakeoff = useCallback((sysId: number, compId: number, actor: string, relativeAltitudeM: number, altitudeToleranceM: number) => streamRef.current?.send(encodeGuidedTakeoffRequest({ requestId: requestId('takeoff'), sysId, compId, actor, timestampMs: Date.now(), relativeAltitudeM, altitudeToleranceM })) ?? false, [])
  const sendGuidedLand = useCallback((sysId: number, compId: number, actor: string) => streamRef.current?.send(encodeGuidedLandRequest({ requestId: requestId('land'), sysId, compId, actor, timestampMs: Date.now() })) ?? false, [])

  useEffect(() => {
    // Per-system folds: two vehicles must never merge into one aircraft.
    const vehicles = new Map<string, VehicleState>()
    const tracks = new Map<string, TrackState>()
    // ENU accumulation for the HUD recorder, reusing hud-ui's pure position fold.
    const origins = new Map<string, GeoOrigin | null>()
    const positions = new Map<string, PositionState>()
    const enuTracks = new Map<string, EnuTrackPoint[]>()
    const missions = new Map<string, MissionPlan>()
    const homes = new Map<string, HomePosition>()
    const flightStates = new Map<string, FlightStateWireFrame>()
    const guidedStatuses = new Map<string, GuidedRepositionWireFrame>()
    const modeStatuses = new Map<string, ModeChangeWireFrame>(), armStatuses = new Map<string, ArmDisarmWireFrame>(), takeoffStatuses = new Map<string, GuidedTakeoffWireFrame>(), landStatuses = new Map<string, GuidedLandWireFrame>()
    let frameCount = 0
    let decodeErrorCount = 0
    let connectionState: ConnectionState = 'connecting'
    // Null means "the bridge hasn't told us yet" — must not default to false, or the
    // Load-mission button would read as enabled before a real linkMode frame arrives.
    let replayMode: boolean | null = null
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
        mission: missions.get(activeKey) ?? EMPTY_MISSION,
        home: homes.get(activeKey) ?? null,
        replayMode,
        flightState: flightStates.get(activeKey) ?? null,
        guidedReposition: guidedStatuses.get(activeKey) ?? null,
        modeChange: modeStatuses.get(activeKey) ?? null,
        armDisarm: armStatuses.get(activeKey) ?? null,
        guidedTakeoff: takeoffStatuses.get(activeKey) ?? null,
        guidedLand: landStatuses.get(activeKey) ?? null,
      })
    }

    const stream = startTelemetryStream(
      { url, socketFactory: browserSocketFactory },
      {
        onFrame: (frame) => {
          frameCount += 1
          logEntries = appendLogEntry(logEntries, toLogEntry(nextLogId++, frame), LOG_MAX_ENTRIES)
          logDirty = true

          const key = systemKey(frame.sysId, frame.compId)
          const vehicle = mergeVehicleState(vehicles.get(key) ?? null, frame)
          vehicles.set(key, vehicle)

          // The vehicle fold deliberately retains its last absolute fix across
          // attitude/VFR frames. Advance breadcrumbs only when a real position
          // frame arrived, otherwise that retained fix is sampled at unrelated
          // timestamps and a startup placeholder can become a continent-spanning
          // line once GPS initializes.
          if (frame.messageName === 'GLOBAL_POSITION_INT' && hasFix(vehicle)) {
            const step = appendTrackPoint(
              tracks.get(key) ?? null,
              { latDeg: vehicle.latDeg, lonDeg: vehicle.lonDeg, timestampMs: frame.recvTimestampMs },
              trackConfig,
            )
            tracks.set(key, step.state)

            // Origin is captured lazily at the first absolute fix. A large
            // discontinuity is a new position epoch, so reset the ENU trail too.
            if (!origins.has(key) || step.reset) {
              origins.set(key, originFromSample(vehicle.sample))
              positions.delete(key)
              enuTracks.set(key, [])
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
        onMission: (frame) => {
          const key = systemKey(frame.sysId, frame.compId)
          missions.set(key, missionPlanFromFrame(frame))

          // Unconditional, unlike the publish() below: a plan belonging to a node
          // that isn't the selected one is exactly what the fleet picture is for.
          // Gating this on the selection would store every other node's mission
          // and then never show it.
          setMissionsByKey(new Map(missions))

          const selected = selectedRef.current
          if (selected === null || selected === key) {
            publish(selected ?? key)
          }
        },
        onHome: (frame) => {
          const key = systemKey(frame.sysId, frame.compId)
          homes.set(key, homeFromWireFrame(frame))

          const selected = selectedRef.current
          if (selected === null || selected === key) {
            publish(selected ?? key)
          }
        },
        onLinkMode: (frame) => {
          replayMode = frame.replayMode
          setSnapshot((previous) => ({ ...previous, replayMode }))
        },
        onFlightState: (frame) => {
          const key = systemKey(frame.sysId, frame.compId)
          flightStates.set(key, frame)
          const selected = selectedRef.current
          if (selected === null || selected === key) publish(selected ?? key)
        },
        onGuidedReposition: (frame) => {
          if (frame.sysId === null || frame.compId === null) return
          const key = systemKey(frame.sysId, frame.compId)
          guidedStatuses.set(key, frame)
          const selected = selectedRef.current
          if (selected === null || selected === key) publish(selected ?? key)
        },
        onModeChange: (frame) => { if (frame.sysId && frame.compId) { const key = systemKey(frame.sysId, frame.compId); modeStatuses.set(key, frame); const selected = selectedRef.current; if (selected === null || selected === key) publish(selected ?? key) } },
        onArmDisarm: (frame) => { if (frame.sysId && frame.compId) { const key = systemKey(frame.sysId, frame.compId); armStatuses.set(key, frame); const selected = selectedRef.current; if (selected === null || selected === key) publish(selected ?? key) } },
        onGuidedTakeoff: (frame) => { if (frame.sysId && frame.compId) { const key = systemKey(frame.sysId, frame.compId); takeoffStatuses.set(key, frame); const selected = selectedRef.current; if (selected === null || selected === key) publish(selected ?? key) } },
        onGuidedLand: (frame) => { if (frame.sysId && frame.compId) { const key = systemKey(frame.sysId, frame.compId); landStatuses.set(key, frame); const selected = selectedRef.current; if (selected === null || selected === key) publish(selected ?? key) } },
        onConnectionState: (state) => {
          connectionState = state
          // The bridge resends linkMode fresh on every new connection ('connecting'
          // fires on every reconnect), so any previously known value is stale until
          // it does — go back to "not told yet" rather than keep showing the old one.
          if (state === 'connecting') {
            replayMode = null
          }
          setSnapshot((previous) => ({ ...previous, connectionState: state, replayMode }))
        },
        onDecodeError: () => {
          decodeErrorCount += 1
          logEntries = appendLogEntry(logEntries, toDecodeErrorEntry(nextLogId++, Date.now()), LOG_MAX_ENTRIES)
          logDirty = true
        },
      },
    )

    streamRef.current = stream

    const logTimer = setInterval(() => {
      if (!logDirty) {
        return
      }

      logDirty = false
      setLog(logEntries)
    }, LOG_PUBLISH_MS)

    /*
     * Recomputed from the live `vehicles` fold rather than accumulated, so there
     * is no second copy of node state to bound or keep in step — the TTL sweep
     * below is still the only thing that decides which nodes exist.
     */
    const nodeTimer = setInterval(() => {
      setNodes(summarizeNodes(vehicles.values(), Date.now()))
    }, NODE_PUBLISH_MS)

    const sweepTimer = setInterval(() => {
      const staleBeforeMs = Date.now() - SYSTEM_TTL_MS
      let droppedMission = false

      vehicles.forEach((vehicle, key) => {
        if (vehicle.lastUpdateMs >= staleBeforeMs) {
          return
        }

        vehicles.delete(key)
        tracks.delete(key)
        origins.delete(key)
        positions.delete(key)
        enuTracks.delete(key)
        droppedMission = missions.delete(key) || droppedMission
        homes.delete(key)
        flightStates.delete(key)
        guidedStatuses.delete(key)
        modeStatuses.delete(key); armStatuses.delete(key); takeoffStatuses.delete(key); landStatuses.delete(key)
      })

      // The roster recomputes from `vehicles` on its own timer, but the published
      // mission map is a copy — without this, an evicted node's route would stay
      // on the fleet map after the node itself had gone.
      if (droppedMission) {
        setMissionsByKey(new Map(missions))
      }
    }, SYSTEM_SWEEP_MS)

    return () => {
      clearInterval(logTimer)
      clearInterval(nodeTimer)
      clearInterval(sweepTimer)
      stream.stop()
      streamRef.current = null
      setSnapshot(INITIAL)
      setLog([])
      setNodes([])
      setMissionsByKey(new Map())
    }
  }, [url, trackConfig])

  return { ...snapshot, log, nodes, missions: missionsByKey, requestMission, sendGuidedReposition,
    sendSetGuided, sendSetArmed, sendGuidedTakeoff, sendGuidedLand }
}
