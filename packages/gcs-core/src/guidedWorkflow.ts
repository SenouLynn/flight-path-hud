import { GUIDED_STATE_FRESH_MS, guidedModeFor } from './guidedReposition'

const validTarget = (value: number) => Number.isInteger(value) && value > 0 && value <= 255

interface RequestBase { requestId: string; sysId: number; compId: number; actor: string; timestampMs: number }

function base(request: RequestBase): RequestBase {
  if (!request.requestId || !validTarget(request.sysId) || !validTarget(request.compId)
    || !request.actor.trim() || !Number.isFinite(request.timestampMs)) throw new Error('invalid workflow request')
  return request
}

export const encodeSetGuidedRequest = (request: RequestBase): string => JSON.stringify({
  type: 'setMode', ...base(request), mode: 'GUIDED', confirmation: true,
})

export const encodeSetArmedRequest = (request: RequestBase & { arm: boolean }): string => JSON.stringify({
  type: 'setArmed', ...base(request), arm: request.arm, confirmation: true, safetyCase: 'sitl-no-propulsion',
})

export const encodeGuidedTakeoffRequest = (request: RequestBase & { relativeAltitudeM: number; altitudeToleranceM: number }): string => JSON.stringify({
  type: 'guidedTakeoff', ...base(request), relativeAltitudeM: request.relativeAltitudeM,
  altitudeToleranceM: request.altitudeToleranceM, confirmation: true, safetyCase: 'isolated-sitl-guided',
})

export const encodeGuidedLandRequest = (request: RequestBase): string => JSON.stringify({
  type: 'guidedLand', ...base(request), confirmation: true, safetyCase: 'isolated-sitl-guided',
})

type LifecycleStatus = { status: string } | null

export interface GuidedWorkflowStateInput {
  target: { sysId: number; compId: number } | null
  connectionState: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  replayMode: boolean | null
  nowMs: number
  flightState: {
    armed: boolean
    customMode: number
    vehicleType: number
    autopilotType: number
    observedAtMs: number
  } | null
  actor: string
  confirmedFor: string | null
  altitudeM: number
  altitudeToleranceM: number
  relativeAltitudeM: number | null
  modeStatus: LifecycleStatus
  armStatus: LifecycleStatus
  takeoffStatus: LifecycleStatus
  landStatus: (LifecycleStatus & { touchdownAltitudeM?: number }) | null
}

export interface GuidedWorkflowState {
  confirmationKey: string | null
  confirmed: boolean
  reason: string | null
  busy: boolean
  fresh: boolean
  inGuided: boolean
  landed: boolean
  canEnterGuided: boolean
  canArm: boolean
  canTakeoff: boolean
  canLand: boolean
  canDisarm: boolean
}

const pending = (value: LifecycleStatus) => value?.status === 'awaitingAck' || value?.status === 'awaitingObservation'

/** Stable, collision-safe binding for the exact target, operator, and takeoff bounds being confirmed. */
export function guidedWorkflowConfirmationKey(input: {
  target: { sysId: number; compId: number } | null
  actor: string
  altitudeM: number
  altitudeToleranceM: number
}): string | null {
  if (input.target === null || !validTarget(input.target.sysId) || !validTarget(input.target.compId)
    || !input.actor.trim() || !Number.isFinite(input.altitudeM)
    || !Number.isFinite(input.altitudeToleranceM)) return null
  return JSON.stringify([input.target.sysId, input.target.compId, input.actor.trim(),
    input.altitudeM, input.altitudeToleranceM])
}

/** Pure operator-workflow policy. Transport, React state, and command emission stay outside this seam. */
export function resolveGuidedWorkflow(input: GuidedWorkflowStateInput): GuidedWorkflowState {
  const state = input.flightState
  const confirmationKey = guidedWorkflowConfirmationKey(input)
  const confirmed = confirmationKey !== null && input.confirmedFor === confirmationKey
  const fresh = state !== null && Number.isFinite(input.nowMs)
    && input.nowMs - state.observedAtMs <= GUIDED_STATE_FRESH_MS
  const guidedMode = state === null ? null : guidedModeFor(state.vehicleType)
  const inGuided = guidedMode !== null && state?.customMode === guidedMode
  const busy = pending(input.modeStatus) || pending(input.armStatus)
    || pending(input.takeoffStatus) || pending(input.landStatus)
  const touchdownAltitudeM = input.landStatus?.touchdownAltitudeM
  const landed = input.landStatus?.status === 'complete'
    && typeof touchdownAltitudeM === 'number' && Number.isFinite(input.relativeAltitudeM)
    && (input.relativeAltitudeM as number) <= touchdownAltitudeM
  const validTakeoff = Number.isFinite(input.altitudeM) && input.altitudeM >= 2 && input.altitudeM <= 120
    && Number.isFinite(input.altitudeToleranceM) && input.altitudeToleranceM >= 0.5
    && input.altitudeToleranceM <= 10

  let reason: string | null = null
  if (input.connectionState !== 'open') reason = 'Open telemetry link required'
  else if (input.replayMode !== false) reason = input.replayMode
    ? 'Commands are disabled during replay' : 'Waiting for live-link mode'
  else if (!fresh) reason = 'Fresh HEARTBEAT state required'
  else if (state?.autopilotType !== 3 || state.vehicleType !== 2) reason = 'This workflow currently supports ArduCopter only'
  else if (!input.actor.trim()) reason = 'Operator identity required'
  else if (!confirmed) reason = 'Confirm the exact target and isolated-SITL workflow'
  else if (busy) reason = 'A workflow command is pending'

  const common = reason === null
  return {
    confirmationKey, confirmed, reason, busy, fresh, inGuided, landed,
    canEnterGuided: common && state?.armed === false && !inGuided,
    canArm: common && state?.armed === false && inGuided,
    canTakeoff: common && state?.armed === true && inGuided && validTakeoff,
    canLand: common && state?.armed === true && inGuided,
    canDisarm: common && state?.armed === true && landed,
  }
}
