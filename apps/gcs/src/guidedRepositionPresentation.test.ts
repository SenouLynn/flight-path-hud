import { describe, expect, it } from 'vitest'
import { guidedConfirmationKey, guidedDefaults, showGuidedGateReason,
  type GuidedFormValues } from './guidedRepositionPresentation'

const values: GuidedFormValues = { targetKey: '1:1', actor: 'operator',
  latitude: '-35.36', longitude: '149.16', altitude: '30', arrivalRadius: '8',
  altitudeTolerance: '5', loiterRadius: '75', loiterDirection: 'clockwise' }

describe('Guided reposition presentation safety', () => {
  it('uses vehicle-specific defaults validated in SITL', () => {
    expect(guidedDefaults(false)).toEqual({ arrivalRadius: '8', altitudeTolerance: '5' })
    expect(guidedDefaults(true)).toEqual({ arrivalRadius: '100', altitudeTolerance: '15' })
  })

  it('invalidates confirmation for identity, target, or movement changes', () => {
    const confirmed = guidedConfirmationKey(values)
    for (const changed of [
      { ...values, actor: 'another operator' },
      { ...values, targetKey: '2:1' },
      { ...values, latitude: '-35.35' },
      { ...values, arrivalRadius: '9' },
      { ...values, loiterDirection: 'counterclockwise' as const },
    ]) expect(guidedConfirmationKey(changed)).not.toBe(confirmed)
  })

  it('lets pending and submitted lifecycle feedback supersede preparation warnings', () => {
    const key = guidedConfirmationKey(values)
    expect(showGuidedGateReason({ enabled: false, pending: true,
      submittedFor: null, confirmationKey: key })).toBe(false)
    expect(showGuidedGateReason({ enabled: false, pending: false,
      submittedFor: key, confirmationKey: key })).toBe(false)
    expect(showGuidedGateReason({ enabled: false, pending: false,
      submittedFor: null, confirmationKey: key })).toBe(true)
  })
})
