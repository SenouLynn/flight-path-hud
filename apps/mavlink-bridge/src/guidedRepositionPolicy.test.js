import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareGuidedReposition } from './guidedRepositionPolicy.js'

const request = (overrides = {}) => ({ type: 'guidedReposition', requestId: 'guided-1',
  sysId: 1, compId: 1, latitudeDeg: 35, longitudeDeg: -80, relativeAltitudeM: 25,
  arrivalRadiusM: 5, altitudeToleranceM: 2,
  actor: 'sitl-guided-controller', timestampMs: 1000, confirmation: true,
  safetyCase: 'isolated-sitl-guided', safetyEnvelope: { minLatitudeDeg: 34.99,
    maxLatitudeDeg: 35.01, minLongitudeDeg: -80.01, maxLongitudeDeg: -79.99,
    minRelativeAltitudeM: 10, maxRelativeAltitudeM: 120, maxArrivalRadiusM: 20,
    maxAltitudeToleranceM: 10 }, ...overrides })

test('prepares distinct portable Copter and Plane commands without sending', () => {
  const copter = prepareGuidedReposition({ request: request(),
    flightState: { autopilotType: 3, vehicleType: 2, armed: true, customMode: 4 } })
  assert.equal(copter.accepted, true)
  assert.deepEqual({ vehicleType: copter.command.vehicleType, radius: copter.command.loiterRadiusM,
    direction: copter.command.loiterDirection }, { vehicleType: 2, radius: null, direction: null })

  const plane = prepareGuidedReposition({ request: request({ sysId: 2, relativeAltitudeM: 100,
    loiterRadiusM: 75, loiterDirection: 'counterclockwise', safetyEnvelope: {
      ...request().safetyEnvelope, maxLoiterRadiusM: 100 } }),
    flightState: { autopilotType: 3, vehicleType: 1, armed: true, customMode: 15 } })
  assert.equal(plane.accepted, true)
  assert.deepEqual({ vehicleType: plane.command.vehicleType, radius: plane.command.loiterRadiusM,
    direction: plane.command.loiterDirection }, { vehicleType: 1, radius: 75, direction: 'counterclockwise' })
})

test('fails closed unless identity, attestation, arm state, and vehicle-specific mode agree', () => {
  const state = { autopilotType: 3, vehicleType: 2, armed: true, customMode: 4 }
  const cases = [
    [request({ sysId: 0 }), state, /target/],
    [request({ confirmation: false }), state, /confirmation/],
    [request(), null, /HEARTBEAT/],
    [request(), { ...state, autopilotType: 12 }, /allowlisted/],
    [request(), { ...state, armed: false }, /armed/],
    [request(), { ...state, customMode: 5 }, /Guided mode/],
    [request({ loiterRadiusM: 50 }), state, /does not accept/],
    [request({ latitudeDeg: 36 }), state, /safety envelope/],
    [request({ arrivalRadiusM: 25 }), state, /safety envelope/],
    [request({ altitudeToleranceM: 11 }), state, /safety envelope/],
    [request({ safetyEnvelope: null }), state, /safety envelope/],
  ]
  for (const [candidate, flightState, reason] of cases) {
    const result = prepareGuidedReposition({ request: candidate, flightState })
    assert.equal(result.accepted, false); assert.equal(result.command, null); assert.match(result.reason, reason)
  }
})

test('Plane target and loiter radius must both fit its explicit envelope', () => {
  const state = { autopilotType: 3, vehicleType: 1, armed: true, customMode: 15 }
  const safetyEnvelope = { ...request().safetyEnvelope, maxLoiterRadiusM: 50 }
  const result = prepareGuidedReposition({ request: request({ loiterRadiusM: 75,
    loiterDirection: 'clockwise', safetyEnvelope }), flightState: state })
  assert.equal(result.accepted, false)
  assert.match(result.reason, /safety envelope/)
})
