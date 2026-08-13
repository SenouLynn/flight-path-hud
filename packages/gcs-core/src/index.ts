/**
 * Framework-agnostic core for the ground-control station.
 *
 * Zero runtime dependencies, no DOM and no renderer: everything here runs
 * unchanged in a browser, under Node for log consumption, and on a Pi build.
 * Map rendering is an adapter concern and lives in the consuming app.
 */

export {
  UNKNOWN_HEADING_CDEG,
  bearingDeg,
  cdegToDeg,
  degE7ToDeg,
  distanceM,
  normalizeBearingDeg,
  type LatLon,
} from './geodesy'

export {
  encodeRequestMission,
  parseWireEvent,
  parseWireFrame,
  parseWireMessage,
  systemKey,
  type HomeWireFrame,
  type FlightStateWireFrame,
  type GuidedRepositionStatus,
  type GuidedRepositionWireFrame,
  type GuidedTakeoffWireFrame,
  type GuidedLandWireFrame,
  type ModeChangeWireFrame,
  type ArmDisarmWireFrame,
  type CommandLifecycleStatus,
  type LinkModeWireFrame,
  type MissionItemWire,
  type MissionWireFrame,
  type TelemetrySample,
  type WireEvent,
  type WireFrame,
} from './wire'

export {
  HEADING_FALLBACK_AFTER_MS,
  hasFix,
  mergeVehicleState,
  type HeadingSource,
  type VehicleState,
} from './vehicle'

export {
  DEFAULT_TRACK_CONFIG,
  EMPTY_TRACK,
  appendTrackPoint,
  trackLengthM,
  type TrackConfig,
  type TrackPoint,
  type TrackState,
  type TrackStepResult,
} from './track'

export {
  startTelemetryStream,
  type ConnectionState,
  type SocketLike,
  type StreamHandle,
  type StreamHandlers,
  type StreamOptions,
} from './stream'

export {
  appendLogEntry,
  describeSample,
  logMessageNames,
  toDecodeErrorEntry,
  toLogEntry,
  type LogEntry,
  type LogKind,
} from './log'

export {
  formatParameterValue,
  parameterMessages,
  readParameters,
  type ParameterRow,
} from './parameters'

export {
  DEFAULT_VIDEO_HEALTH_CONFIG,
  EMPTY_VIDEO_HEALTH_STATE,
  IDLE_VIDEO_HEALTH,
  foldVideoHealth,
  setVideoConnectionState,
  type VideoConnectionState,
  type VideoHealth,
  type VideoHealthConfig,
  type VideoHealthState,
  type VideoStatsSample,
} from './video'

export {
  EMPTY_MISSION,
  missionPlanFromFrame,
  type MissionItem,
  type MissionPlan,
  type MissionStatus,
} from './mission'

export {
  homeFromWireFrame,
  type HomePosition,
} from './home'

export {
  DEFAULT_NODE_FRESHNESS_CONFIG,
  classifyFreshness,
  mavlinkNodeIdentity,
  nodeSummaryFromVehicle,
  parseMavlinkNodeId,
  summarizeNodes,
  systemKeyFromNodeId,
  type MavlinkNodeAddress,
  type NodeFreshness,
  type NodeFreshnessConfig,
  type NodeIdentity,
  type NodeKind,
  type NodeSummary,
} from './nodes'

export {
  GUIDED_STATE_FRESH_MS,
  EMPTY_GUIDED_REPOSITION,
  encodeGuidedRepositionRequest,
  guidedModeFor,
  guidedRepositionGate,
  type GuidedRepositionDraft,
  type GuidedRepositionGateInput,
} from './guidedReposition'

export { encodeSetGuidedRequest, encodeSetArmedRequest, encodeGuidedTakeoffRequest,
  encodeGuidedLandRequest, resolveGuidedWorkflow } from './guidedWorkflow'
export type { GuidedWorkflowState, GuidedWorkflowStateInput } from './guidedWorkflow'
