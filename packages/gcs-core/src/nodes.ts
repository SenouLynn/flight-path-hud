/**
 * A transport-neutral identity and summary layer above `VehicleState`.
 *
 * `sysId:compId` is a MAVLink concept. The destination for this project is
 * TAK-style shared awareness, where a Meshtastic node ID and a Cursor-on-Target
 * UID have to sit on the same picture as a MAVLink vehicle — so the thing the
 * presentation layer consumes cannot be keyed on a MAVLink pair. `NodeIdentity`
 * is that seam: MAVLink becomes one *kind* of identity rather than the only one.
 *
 * Two properties keep this cheap, and both are deliberate:
 *
 * 1. **A `NodeSummary` is derived, never stored.** It is a projection over the
 *    per-system state the feed already accumulates. No new accumulation means
 *    nothing new to bound, evict or sweep.
 * 2. **Freshness is not TTL.** TTL answers "should this node still exist?".
 *    Freshness answers "how much should the operator trust what is drawn?" — a
 *    mesh node last heard from four minutes ago and a vehicle streaming at 33 Hz
 *    must not render identically, long before either is due for eviction.
 *
 * Pure, like the rest of this package: no clock is read here, `nowMs` is passed in.
 */

import { hasFix, type VehicleState } from './vehicle'

/** Extension point. Meshtastic and CoT participants join here, not by pretending to be vehicles. */
export type NodeKind = 'mavlink-vehicle'

export type NodeFreshness = 'live' | 'aging' | 'stale'

export interface NodeIdentity {
  /** Stable and globally unique across transports, e.g. `mavlink:1:1`. */
  id: string
  kind: NodeKind
  /** Operator-facing name. */
  label: string
}

export interface NodeFreshnessConfig {
  /** Age at which a node stops counting as live. */
  agingAfterMs: number
  /** Age at which a node's data should be treated as untrustworthy. */
  staleAfterMs: number
}

/**
 * Tuned against the streams we actually have: telemetry arrives at ~33 Hz, and a
 * MAVLink heartbeat is nominally 1 Hz, so three seconds of silence is already
 * several missed heartbeats rather than ordinary jitter. Both thresholds sit well
 * inside the feed's 60 s eviction TTL, so a node is visibly degraded for a long
 * while before it disappears.
 */
export const DEFAULT_NODE_FRESHNESS_CONFIG: NodeFreshnessConfig = {
  agingAfterMs: 3000,
  staleAfterMs: 15000,
}

export interface NodeSummary {
  identity: NodeIdentity
  latDeg: number | null
  lonDeg: number | null
  altMslM: number | null
  headingDeg: number | null
  groundSpeedMps: number | null
  /** When this node last reported, on the receiving clock. */
  lastUpdateMs: number
  /** How long ago that was. Never negative. */
  ageMs: number
  freshness: NodeFreshness
  /** Whether there is a position worth drawing at all. */
  hasFix: boolean
}

/**
 * Ids sort naturally rather than lexically, so `mavlink:2:1` precedes
 * `mavlink:10:1` instead of following it — the ordering a roster of a dozen
 * vehicles needs to be readable.
 */
const ID_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' })

/** MAVLink's identity, expressed as a node identity. */
export function mavlinkNodeIdentity(sysId: number, compId: number, label?: string): NodeIdentity {
  return {
    id: `mavlink:${sysId}:${compId}`,
    kind: 'mavlink-vehicle',
    // Defaults to the `sysId:compId` string the existing system selector already
    // shows, so the two surfaces name the same vehicle the same way.
    label: label ?? `${sysId}:${compId}`,
  }
}

/**
 * Thresholds are inclusive lower bounds: an age of exactly `agingAfterMs` is
 * already `aging`. A negative age (a reporter whose clock runs ahead of ours) is
 * treated as zero rather than wrapping round to `stale`.
 */
export function classifyFreshness(
  ageMs: number,
  config: NodeFreshnessConfig = DEFAULT_NODE_FRESHNESS_CONFIG,
): NodeFreshness {
  const age = Math.max(ageMs, 0)

  if (age >= config.staleAfterMs) {
    return 'stale'
  }

  if (age >= config.agingAfterMs) {
    return 'aging'
  }

  return 'live'
}

export function nodeSummaryFromVehicle(
  vehicle: VehicleState,
  nowMs: number,
  config: NodeFreshnessConfig = DEFAULT_NODE_FRESHNESS_CONFIG,
): NodeSummary {
  const ageMs = Math.max(nowMs - vehicle.lastUpdateMs, 0)

  return {
    identity: mavlinkNodeIdentity(vehicle.sysId, vehicle.compId),
    latDeg: vehicle.latDeg,
    lonDeg: vehicle.lonDeg,
    altMslM: vehicle.altMslM,
    headingDeg: vehicle.headingDeg,
    groundSpeedMps: vehicle.groundSpeedMps,
    lastUpdateMs: vehicle.lastUpdateMs,
    ageMs,
    freshness: classifyFreshness(ageMs, config),
    hasFix: hasFix(vehicle),
  }
}

/**
 * Project every known vehicle into a roster, in a stable order.
 *
 * The order must not depend on which node happened to report last, or a roster
 * would reshuffle under the operator's cursor at telemetry rate.
 */
export function summarizeNodes(
  vehicles: Iterable<VehicleState>,
  nowMs: number,
  config: NodeFreshnessConfig = DEFAULT_NODE_FRESHNESS_CONFIG,
): NodeSummary[] {
  return [...vehicles]
    .map((vehicle) => nodeSummaryFromVehicle(vehicle, nowMs, config))
    .sort((left, right) => ID_COLLATOR.compare(left.identity.id, right.identity.id))
}
