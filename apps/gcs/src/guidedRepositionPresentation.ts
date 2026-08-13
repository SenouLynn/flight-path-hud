export interface GuidedFormValues {
  targetKey: string | null
  actor: string
  latitude: string
  longitude: string
  altitude: string
  arrivalRadius: string
  altitudeTolerance: string
  loiterRadius: string
  loiterDirection: 'clockwise' | 'counterclockwise'
}

export function guidedDefaults(isPlane: boolean): Pick<GuidedFormValues, 'arrivalRadius' | 'altitudeTolerance'> {
  return isPlane
    ? { arrivalRadius: '100', altitudeTolerance: '15' }
    : { arrivalRadius: '8', altitudeTolerance: '5' }
}

/** Binds confirmation to the operator, exact target, and every movement field. */
export function guidedConfirmationKey(values: GuidedFormValues): string {
  return JSON.stringify(values)
}

export function showGuidedGateReason({ enabled, pending, submittedFor, confirmationKey }: {
  enabled: boolean
  pending: boolean
  submittedFor: string | null
  confirmationKey: string
}): boolean {
  return !enabled && !pending && submittedFor !== confirmationKey
}
