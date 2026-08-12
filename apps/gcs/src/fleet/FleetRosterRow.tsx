/**
 * One node in the roster.
 *
 * Two sibling buttons, never nested: a primary one covering the node's identity
 * and readouts that focuses it, and a separate "Load mission". A button inside a
 * button is invalid markup and browsers disagree about which one a click means.
 */

import type { MissionPlan, NodeSummary } from '@flight-path-hud/gcs-core'
import { formatCoord, formatNumber } from '../format'
import type { MissionGate } from '../missionGate'

interface FleetRosterRowProps {
  node: NodeSummary
  color: string
  /** This node's plan, or null if it has never been asked for one. */
  mission: MissionPlan | null
  gate: MissionGate
  selected: boolean
  onFocus: () => void
  onLoadMission: () => void
}

/** Seconds at one decimal below a minute, whole minutes above — an age, not a clock. */
function formatAge(ageMs: number): string {
  const seconds = ageMs / 1000

  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min`
}

export function FleetRosterRow({
  node,
  color,
  mission,
  gate,
  selected,
  onFocus,
  onLoadMission,
}: FleetRosterRowProps) {
  const waypointCount = mission?.items.length ?? 0

  return (
    <li className={selected ? 'fleet-row selected' : 'fleet-row'}>
      <button
        type="button"
        className="fleet-row-main"
        onClick={onFocus}
        title={`Open ${node.identity.label} in the node view`}
      >
        <span className="fleet-row-head">
          {/* Matches this node's map marker, route and waypoint badges. */}
          <span className="fleet-swatch" style={{ background: color }} aria-hidden="true" />
          <strong className="fleet-row-label">{node.identity.label}</strong>
          <span className={`node-freshness ${node.freshness}`}>{node.freshness}</span>
        </span>

        <span className="fleet-row-stats">
          {node.hasFix ? (
            <>
              <span>{formatCoord(node.latDeg)}, {formatCoord(node.lonDeg)}</span>
              <span>{formatNumber(node.altMslM, 0, ' m')}</span>
              <span>{formatNumber(node.groundSpeedMps, 1, ' m/s')}</span>
            </>
          ) : (
            // Rostered but not drawable: the node is on the link, it just has no
            // position worth putting on a map yet.
            <span className="fleet-row-nofix">no fix</span>
          )}
          <span className="fleet-row-age">{formatAge(node.ageMs)} ago</span>
        </span>
      </button>

      <div className="fleet-row-actions">
        <button
          type="button"
          className="segment"
          disabled={!gate.enabled}
          onClick={onLoadMission}
          title={gate.reason ?? `Request ${node.identity.label}'s mission`}
        >
          Load mission
        </button>
        <span className="fleet-row-mission">
          {mission === null
            ? '—'
            : `${waypointCount} wp${mission.status === 'failed' ? ' (failed)' : ''}`}
        </span>
      </div>
    </li>
  )
}
