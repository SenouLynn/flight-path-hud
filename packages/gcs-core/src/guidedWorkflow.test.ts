import { describe, expect, it } from 'vitest'
import { resolveGuidedWorkflow, type GuidedWorkflowStateInput } from './guidedWorkflow'

const base = (overrides: Partial<GuidedWorkflowStateInput> = {}): GuidedWorkflowStateInput => ({
  connectionState: 'open', replayMode: false, nowMs: 2000,
  flightState: { armed: false, customMode: 0, vehicleType: 2, autopilotType: 3, observedAtMs: 1900 },
  actor: 'operator', confirmed: true, altitudeM: 10, altitudeToleranceM: 2,
  relativeAltitudeM: 0, modeStatus: null, armStatus: null, takeoffStatus: null, landStatus: null,
  ...overrides,
})

describe('resolveGuidedWorkflow', () => {
  it('advances action eligibility from Guided entry through verified touchdown', () => {
    expect(resolveGuidedWorkflow(base()).canEnterGuided).toBe(true)
    const guided = base({ flightState: { ...base().flightState!, customMode: 4 } })
    expect(resolveGuidedWorkflow(guided).canArm).toBe(true)
    const airborne = base({ flightState: { ...guided.flightState!, armed: true }, relativeAltitudeM: 10 })
    expect(resolveGuidedWorkflow(airborne)).toMatchObject({ canTakeoff: true, canLand: true, canDisarm: false })
    expect(resolveGuidedWorkflow({ ...airborne, relativeAltitudeM: 0.5,
      landStatus: { status: 'complete', touchdownAltitudeM: 0.75 } }).canDisarm).toBe(true)
  })

  it('fails closed for replay, stale state, unsupported vehicles, and pending commands', () => {
    expect(resolveGuidedWorkflow(base({ replayMode: true })).reason).toMatch(/replay/)
    expect(resolveGuidedWorkflow(base({ nowMs: 6000 })).reason).toMatch(/Fresh HEARTBEAT/)
    expect(resolveGuidedWorkflow(base({ flightState: { ...base().flightState!, vehicleType: 1 } })).reason).toMatch(/ArduCopter/)
    const pending = resolveGuidedWorkflow(base({ modeStatus: { status: 'awaitingAck' } }))
    expect(pending).toMatchObject({ busy: true, canEnterGuided: false, reason: 'A workflow command is pending' })
  })

  it('requires explicit operator confirmation and bounded takeoff inputs', () => {
    expect(resolveGuidedWorkflow(base({ actor: '' })).reason).toMatch(/identity/)
    expect(resolveGuidedWorkflow(base({ confirmed: false })).reason).toMatch(/Confirm/)
    const guidedArmed = { ...base().flightState!, armed: true, customMode: 4 }
    expect(resolveGuidedWorkflow(base({ flightState: guidedArmed, altitudeM: 121 })).canTakeoff).toBe(false)
    expect(resolveGuidedWorkflow(base({ flightState: guidedArmed, altitudeToleranceM: 0.1 })).canTakeoff).toBe(false)
  })
})
