/**
 * Every node on the link, in `summarizeNodes`' order — already sorted by id with
 * numeric collation, so `mavlink:2:1` precedes `mavlink:10:1` and the list does
 * not reshuffle under the operator's cursor when a node reports.
 *
 * Presentation only: it reads `NodeSummary[]` and forwards clicks. The roster is
 * a projection over the feed's per-system folds, not state of its own.
 */

import { systemKeyFromNodeId, type ConnectionState, type MissionPlan, type NodeSummary } from '@flight-path-hud/gcs-core'
import { missionGate } from '../missionGate'
import { missionFor } from './fleetMapData'
import { FleetRosterRow } from './FleetRosterRow'

interface FleetRosterProps {
  nodes: NodeSummary[]
  missions: ReadonlyMap<string, MissionPlan>
  colorOf: (nodeId: string) => string
  connectionState: ConnectionState
  replayMode: boolean | null
  /** systemKey of the node the node view is pinned to, if any. */
  selectedSystem: string | null
  /** Nodes taken off the map. Still listed here — the eye is a toggle, not a filter. */
  hiddenNodeIds: ReadonlySet<string>
  onToggleNodeHidden: (nodeId: string) => void
  onCenterNode: (nodeId: string) => void
  onFocusNode: (nodeId: string) => void
  onLoadMission: (nodeId: string) => void
}

export function FleetRoster({
  nodes,
  missions,
  colorOf,
  connectionState,
  replayMode,
  selectedSystem,
  hiddenNodeIds,
  onToggleNodeHidden,
  onCenterNode,
  onFocusNode,
  onLoadMission,
}: FleetRosterProps) {
  return (
    <section className="panel fleet-roster">
      <h2>Fleet ({nodes.length})</h2>

      {nodes.length === 0 ? (
        <p className="fleet-empty">
          {connectionState === 'open'
            ? 'No nodes heard yet.'
            : 'Waiting for the link.'}
        </p>
      ) : (
        <ul className="fleet-list">
          {nodes.map((node) => (
            <FleetRosterRow
              key={node.identity.id}
              node={node}
              color={colorOf(node.identity.id)}
              mission={missionFor(node, missions)}
              // A node in the roster exists by definition, so the only questions
              // left are about the link itself.
              gate={missionGate(connectionState, replayMode, true)}
              // Compared through the id, never through `identity.label` — the
              // label only happens to equal the system key today.
              selected={selectedSystem !== null && systemKeyFromNodeId(node.identity.id) === selectedSystem}
              visible={!hiddenNodeIds.has(node.identity.id)}
              onToggleVisible={() => onToggleNodeHidden(node.identity.id)}
              onCenter={() => onCenterNode(node.identity.id)}
              onOpen={() => onFocusNode(node.identity.id)}
              onLoadMission={() => onLoadMission(node.identity.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
