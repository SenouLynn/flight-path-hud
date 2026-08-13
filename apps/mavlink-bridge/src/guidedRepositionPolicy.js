import { encodeGuidedReposition, MAV_TYPE_FIXED_WING, MAV_TYPE_QUADROTOR } from './guidedRepositionProtocol.js'

const MAV_AUTOPILOT_ARDUPILOTMEGA = 3
const GUIDED_CUSTOM_MODE = new Map([
  [MAV_TYPE_QUADROTOR, 4],
  [MAV_TYPE_FIXED_WING, 15],
])
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

function validatesEnvelope(request, vehicleType) {
  const e = request.safetyEnvelope
  if (e === null || typeof e !== 'object'
    || ![e.minLatitudeDeg, e.maxLatitudeDeg, e.minLongitudeDeg, e.maxLongitudeDeg,
      e.minRelativeAltitudeM, e.maxRelativeAltitudeM, e.maxArrivalRadiusM,
      e.maxAltitudeToleranceM].every(finite)
    || e.minLatitudeDeg > e.maxLatitudeDeg || e.minLongitudeDeg > e.maxLongitudeDeg
    || e.minRelativeAltitudeM > e.maxRelativeAltitudeM) return false
  if (request.latitudeDeg < e.minLatitudeDeg || request.latitudeDeg > e.maxLatitudeDeg
    || request.longitudeDeg < e.minLongitudeDeg || request.longitudeDeg > e.maxLongitudeDeg
    || request.relativeAltitudeM < e.minRelativeAltitudeM
    || request.relativeAltitudeM > e.maxRelativeAltitudeM) return false
  if (!finite(request.arrivalRadiusM) || request.arrivalRadiusM <= 0
    || request.arrivalRadiusM > e.maxArrivalRadiusM
    || !finite(request.altitudeToleranceM) || request.altitudeToleranceM <= 0
    || request.altitudeToleranceM > e.maxAltitudeToleranceM) return false
  return vehicleType !== MAV_TYPE_FIXED_WING
    || (finite(e.maxLoiterRadiusM) && e.maxLoiterRadiusM > 0
      && request.loiterRadiusM <= e.maxLoiterRadiusM)
}

/**
 * Pure, transport-free policy boundary. It can be ported independently and is intentionally
 * not registered with the live bridge until vehicle-specific SITL evidence exists.
 */
export function prepareGuidedReposition({ request, flightState, gcsSysId = 255, gcsCompId = 190 } = {}) {
  const reject = (reason) => ({ accepted: false, reason, command: null })
  if (request?.type !== 'guidedReposition' || typeof request.requestId !== 'string' || !request.requestId
    || !validId(request.sysId) || !validId(request.compId)) return reject('invalid request or exact target')
  if (typeof request.actor !== 'string' || !request.actor.trim() || !Number.isFinite(request.timestampMs)
    || request.confirmation !== true || request.safetyCase !== 'isolated-sitl-guided') {
    return reject('actor, timestamp, explicit confirmation, and isolated-sitl-guided safety case are required')
  }
  if (flightState === null || flightState === undefined) return reject('fresh HEARTBEAT state is required')
  const guidedMode = GUIDED_CUSTOM_MODE.get(flightState.vehicleType)
  if (flightState.autopilotType !== MAV_AUTOPILOT_ARDUPILOTMEGA || guidedMode === undefined) return reject('observed autopilot/vehicle type is not allowlisted')
  if (flightState.armed !== true) return reject('Guided reposition requires an armed vehicle')
  if (flightState.customMode !== guidedMode) return reject('vehicle must already be in its vehicle-specific Guided mode')
  if (!validatesEnvelope(request, flightState.vehicleType)) return reject('target or Plane loiter radius is outside the explicit safety envelope')

  try {
    const buffer = encodeGuidedReposition({ sysId: gcsSysId, compId: gcsCompId,
      targetSystemId: request.sysId, targetComponentId: request.compId,
      latitudeDeg: request.latitudeDeg, longitudeDeg: request.longitudeDeg,
      relativeAltitudeM: request.relativeAltitudeM, vehicleType: flightState.vehicleType,
      loiterRadiusM: request.loiterRadiusM, loiterDirection: request.loiterDirection })
    return { accepted: true, reason: null, command: { requestId: request.requestId,
      sysId: request.sysId, compId: request.compId, vehicleType: flightState.vehicleType,
      guidedCustomMode: guidedMode,
      latitudeDeg: request.latitudeDeg, longitudeDeg: request.longitudeDeg,
      relativeAltitudeM: request.relativeAltitudeM,
      arrivalRadiusM: request.arrivalRadiusM, altitudeToleranceM: request.altitudeToleranceM,
      loiterRadiusM: request.loiterRadiusM ?? null, loiterDirection: request.loiterDirection ?? null,
      safetyEnvelope: { ...request.safetyEnvelope },
      actor: request.actor, requestedAtMs: request.timestampMs,
      confirmation: true, safetyCase: request.safetyCase, buffer } }
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'invalid Guided reposition')
  }
}
