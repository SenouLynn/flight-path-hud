/**
 * The node-view scope picker: which exact node are we looking at?
 *
 * Lives beside the Fleet back button so navigation and scope stay together.
 *
 * This is the only node selector. Choosing a node always pins the detail view to
 * that concrete system; a "latest frame wins" option would ping-pong between
 * vehicles on a live multi-node link.
 */

import { systemKeyFromNodeId, type NodeSummary } from '@flight-path-hud/gcs-core'

interface NodePickerProps {
  nodes: NodeSummary[]
  /** systemKey of the node on screen, or null when the fleet is. */
  value: string | null
  /** Null means "back out to the whole fleet". */
  onChange: (systemKey: string | null) => void
}

export function NodePicker({ nodes, value, onChange }: NodePickerProps) {
  const systems = nodes.map((node) => ({
    system: systemKeyFromNodeId(node.identity.id),
    label: node.identity.label,
    id: node.identity.id,
  }))

  /*
   * A node the operator is looking at can be swept as stale out from under them
   * (60 s TTL) while its detail view is still on screen. Without an option to
   * match, the select would silently go blank and stop naming what is displayed.
   */
  const scopeIsGone = value !== null && !systems.some((entry) => entry.system === value)

  return (
    <label className="node-picker">
      <span className="node-picker-label">Scope</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        aria-label="Node scope"
      >
        {/* Selecting this backs out to the fleet, which is what "all of them" means here. */}
        <option value="">Nodes…</option>
        {scopeIsGone ? <option value={value}>{value} (lost)</option> : null}
        {systems.map((entry) => (
          // Valued by system key, never by `identity.label` — the label only
          // happens to equal it today.
          entry.system === null ? null : (
            <option key={entry.id} value={entry.system}>{entry.label}</option>
          )
        ))}
      </select>
    </label>
  )
}
