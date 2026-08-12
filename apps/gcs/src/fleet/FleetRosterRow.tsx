/**
 * One node in the roster.
 *
 * The row body is plain content, not a button. Every action is an explicit
 * control: an eye that takes the node off the map, an arrow that opens its
 * detail view, and Load mission. A large invisible click target that navigates
 * is easy to hit by accident and gives no hint about what it will do.
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
  /** Whether the node view is currently pinned to this node. */
  selected: boolean
  /** Whether this node is currently drawn on the fleet map. */
  visible: boolean
  onToggleVisible: () => void
  onOpen: () => void
  onLoadMission: () => void
}

/** Seconds at one decimal below a minute, whole minutes above — an age, not a clock. */
function formatAge(ageMs: number): string {
  const seconds = ageMs / 1000

  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min`
}

/** Open eye, or struck through when the node is off the map. */
function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {visible ? null : <path d="M2 14 14 2" stroke="currentColor" strokeWidth="1.3" />}
    </svg>
  )
}

/** Arrow into the detail view. */
function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FleetRosterRow({
  node,
  color,
  mission,
  gate,
  selected,
  visible,
  onToggleVisible,
  onOpen,
  onLoadMission,
}: FleetRosterRowProps) {
  const label = node.identity.label
  const waypointCount = mission?.items.length ?? 0

  return (
    <li className={rowClassName(selected, visible)}>
      <div className="fleet-row-head">
        {/* Matches this node's map marker, route and waypoint badges. */}
        <span className="fleet-swatch" style={{ background: color }} aria-hidden="true" />
        <strong className="fleet-row-label">{label}</strong>
        <span className={`node-freshness ${node.freshness}`}>{node.freshness}</span>

        <span className="fleet-row-icons">
          <button
            type="button"
            className="icon-button"
            onClick={onToggleVisible}
            aria-pressed={!visible}
            title={visible ? `Hide ${label} on the map` : `Show ${label} on the map`}
          >
            <EyeIcon visible={visible} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onOpen}
            title={`Open ${label} in the node view`}
          >
            <OpenIcon />
          </button>
        </span>
      </div>

      <div className="fleet-row-stats">
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
      </div>

      <div className="fleet-row-actions">
        <button
          type="button"
          className="segment"
          disabled={!gate.enabled}
          onClick={onLoadMission}
          title={gate.reason ?? `Request ${label}'s mission`}
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

function rowClassName(selected: boolean, visible: boolean): string {
  const classes = ['fleet-row']

  if (selected) {
    classes.push('selected')
  }
  // Dims the whole row, so "not on the map" is legible without reading the eye.
  if (!visible) {
    classes.push('hidden-node')
  }

  return classes.join(' ')
}
