import type { ConnectionState } from './stream'
import type { FlightStateWireFrame, GuidedRepositionWireFrame } from './wire'

export const GUIDED_STATE_FRESH_MS = 3000

export interface GuidedRepositionDraft {
  latitudeDeg: number
  longitudeDeg: number
  relativeAltitudeM: number
  arrivalRadiusM: number
  altitudeToleranceM: number
  loiterRadiusM?: number
  loiterDirection?: 'clockwise' | 'counterclockwise'
}

export interface GuidedRepositionGateInput {
  connectionState: ConnectionState
  replayMode: boolean | null
  flightState: FlightStateWireFrame | null
  nowMs: number
  actor: string
  confirmed: boolean
  draft: GuidedRepositionDraft
}

export function guidedModeFor(vehicleType: number): number | null {
  if (vehicleType === 2) return 4
  if (vehicleType === 1) return 15
  return null
}

export function guidedRepositionGate(input: GuidedRepositionGateInput): { enabled: boolean, reason: string } {
  const { flightState: state, draft } = input
  if (input.connectionState !== 'open') return { enabled: false, reason: 'Telemetry link is not open' }
  if (input.replayMode !== false) return { enabled: false, reason: input.replayMode ? 'Replay is read-only' : 'Waiting for live-link identity' }
  if (state === null) return { enabled: false, reason: 'Waiting for target HEARTBEAT state' }
  if (input.nowMs - state.observedAtMs > GUIDED_STATE_FRESH_MS) return { enabled: false, reason: 'Target HEARTBEAT state is stale' }
  const guidedMode = guidedModeFor(state.vehicleType)
  if (state.autopilotType !== 3 || guidedMode === null) return { enabled: false, reason: 'Target is not an allowlisted ArduPilot Copter or Plane' }
  if (!state.armed) return { enabled: false, reason: 'Target is not armed' }
  if (state.customMode !== guidedMode) return { enabled: false, reason: `Target is not in Guided mode (${guidedMode})` }
  if (![draft.latitudeDeg, draft.longitudeDeg, draft.relativeAltitudeM, draft.arrivalRadiusM,
    draft.altitudeToleranceM].every(Number.isFinite)) return { enabled: false, reason: 'Target fields must be finite numbers' }
  if (draft.latitudeDeg < -90 || draft.latitudeDeg > 90 || draft.longitudeDeg < -180
    || draft.longitudeDeg > 180 || draft.relativeAltitudeM < 1
    || draft.arrivalRadiusM <= 0 || draft.arrivalRadiusM > 120
    || draft.altitudeToleranceM <= 0 || draft.altitudeToleranceM > 20) return { enabled: false, reason: 'Target fields are outside safe numeric bounds' }
  if (state.vehicleType === 1 && (!Number.isFinite(draft.loiterRadiusM) || (draft.loiterRadiusM ?? 0) <= 0
    || (draft.loiterRadiusM ?? 0) > 100
    || !draft.loiterDirection)) return { enabled: false, reason: 'Plane requires loiter radius and direction' }
  if (state.vehicleType === 1 && draft.arrivalRadiusM < (draft.loiterRadiusM ?? 0)) {
    return { enabled: false, reason: 'Plane arrival radius must include its loiter radius' }
  }
  if (!input.actor.trim()) return { enabled: false, reason: 'Operator identity is required' }
  if (!input.confirmed) return { enabled: false, reason: 'Confirm the exact target and movement before sending' }
  return { enabled: true, reason: 'Ready to send one bounded reposition request' }
}

export function encodeGuidedRepositionRequest(request: {
  requestId: string, sysId: number, compId: number, actor: string, timestampMs: number,
  draft: GuidedRepositionDraft,
}): string {
  const { draft } = request
  const latitudeMargin = 0.01
  const longitudeMargin = 0.01
  const altitudeMarginM = 20
  return JSON.stringify({ type: 'guidedReposition', requestId: request.requestId,
    sysId: request.sysId, compId: request.compId, actor: request.actor.trim(),
    timestampMs: request.timestampMs, confirmation: true, safetyCase: 'isolated-sitl-guided',
    ...draft, loiterRadiusM: draft.loiterRadiusM, loiterDirection: draft.loiterDirection,
    safetyEnvelope: { minLatitudeDeg: Math.max(-90, draft.latitudeDeg - latitudeMargin),
      maxLatitudeDeg: Math.min(90, draft.latitudeDeg + latitudeMargin),
      minLongitudeDeg: Math.max(-180, draft.longitudeDeg - longitudeMargin),
      maxLongitudeDeg: Math.min(180, draft.longitudeDeg + longitudeMargin),
      minRelativeAltitudeM: Math.max(1, draft.relativeAltitudeM - altitudeMarginM),
      maxRelativeAltitudeM: draft.relativeAltitudeM + altitudeMarginM,
      maxArrivalRadiusM: 120, maxAltitudeToleranceM: 20,
      ...(draft.loiterRadiusM === undefined ? {} : { maxLoiterRadiusM: 100 }) } })
}

export const EMPTY_GUIDED_REPOSITION: GuidedRepositionWireFrame | null = null
