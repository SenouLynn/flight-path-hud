/**
 * When "Load mission" can be pressed, and what to say when it cannot.
 *
 * Shared by the single-node sidebar and the per-node fleet roster rows so both
 * gate on the same conditions. Two surfaces disagreeing about whether a mission
 * can be requested is the kind of difference an operator reads as a fault in the
 * link rather than in the UI.
 */

import type { ConnectionState } from '@flight-path-hud/gcs-core'

export interface MissionGate {
  /** Whether a mission request can be sent at all. */
  enabled: boolean
  /** Names whichever condition blocks it, for a `title` tooltip. Undefined when enabled. */
  reason: string | undefined
}

/**
 * `replayMode` is checked strictly against `false`: `null` means the bridge has
 * not told us the link mode yet, which must not read as "live" or the button
 * would appear enabled before a real `linkMode` frame arrives.
 */
export function missionGate(
  connectionState: ConnectionState,
  replayMode: boolean | null,
  hasVehicle: boolean,
): MissionGate {
  const reason = blockingReason(connectionState, replayMode, hasVehicle)

  return { enabled: reason === undefined, reason }
}

function blockingReason(
  connectionState: ConnectionState,
  replayMode: boolean | null,
  hasVehicle: boolean,
): string | undefined {
  if (connectionState !== 'open') {
    return 'Link is not connected'
  }
  if (replayMode === null) {
    return 'Waiting for link mode…'
  }
  if (replayMode === true) {
    return "Recorded sessions can't query a live vehicle"
  }
  if (!hasVehicle) {
    return 'No system selected yet'
  }
  return undefined
}
