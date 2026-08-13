import { describe, expect, it } from 'vitest'
import { encodeGuidedRepositionRequest, guidedRepositionGate } from './guidedReposition'

const draft = { latitudeDeg: -35.36, longitudeDeg: 149.16, relativeAltitudeM: 30,
  arrivalRadiusM: 8, altitudeToleranceM: 5 }
const state = { type: 'flightState' as const, sysId: 1, compId: 1, armed: true,
  baseMode: 129, customMode: 4, systemStatus: 4, vehicleType: 2, autopilotType: 3, observedAtMs: 1000 }

describe('Guided reposition operator boundary', () => {
  it('requires a live, fresh, armed, vehicle-specific Guided target and explicit confirmation', () => {
    const ready = { connectionState: 'open' as const, replayMode: false, flightState: state,
      nowMs: 2000, actor: 'operator', confirmed: true, draft }
    expect(guidedRepositionGate(ready).enabled).toBe(true)
    expect(guidedRepositionGate({ ...ready, confirmed: false }).reason).toMatch(/Confirm/)
    expect(guidedRepositionGate({ ...ready, nowMs: 5000 }).reason).toMatch(/stale/)
    expect(guidedRepositionGate({ ...ready, flightState: { ...state, armed: false } }).reason).toMatch(/not armed/)
    expect(guidedRepositionGate({ ...ready, flightState: { ...state, customMode: 3 } }).reason).toMatch(/not in Guided/)
  })

  it('requires Plane-only loiter controls', () => {
    const result = guidedRepositionGate({ connectionState: 'open', replayMode: false,
      flightState: { ...state, vehicleType: 1, customMode: 15 }, nowMs: 2000,
      actor: 'operator', confirmed: true, draft })
    expect(result.reason).toMatch(/Plane requires/)

    const tooTight = guidedRepositionGate({ connectionState: 'open', replayMode: false,
      flightState: { ...state, vehicleType: 1, customMode: 15 }, nowMs: 2000,
      actor: 'operator', confirmed: true,
      draft: { ...draft, loiterRadiusM: 75, loiterDirection: 'clockwise' } })
    expect(tooTight.reason).toMatch(/arrival radius must include/)
  })

  it('encodes exact identity, confirmation, attestation, and a bounded envelope', () => {
    const request = JSON.parse(encodeGuidedRepositionRequest({ requestId: 'r1', sysId: 2,
      compId: 1, actor: ' op ', timestampMs: 2000, draft }))
    expect(request).toMatchObject({ type: 'guidedReposition', requestId: 'r1', sysId: 2,
      compId: 1, actor: 'op', confirmation: true, safetyCase: 'isolated-sitl-guided' })
    expect(request.safetyEnvelope.minLatitudeDeg).toBeLessThan(draft.latitudeDeg)
    expect(request.safetyEnvelope.maxRelativeAltitudeM).toBeGreaterThan(draft.relativeAltitudeM)
  })
})
