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
  parseWireFrame,
  parseWireMessage,
  systemKey,
  type TelemetrySample,
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
