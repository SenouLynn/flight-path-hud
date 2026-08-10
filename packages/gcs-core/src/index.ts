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
