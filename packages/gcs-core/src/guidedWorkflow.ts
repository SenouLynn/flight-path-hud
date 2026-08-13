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
