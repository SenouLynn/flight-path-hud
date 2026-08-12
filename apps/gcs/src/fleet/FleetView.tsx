/**
 * The fleet view: the roster and one map showing every node.
 *
 * The outermost view — the list, with the existing single-node UI as its detail.
 * Independent of that view by design (docs/multi_node_awareness.md): it consumes
 * `NodeSummary[]` directly, owns its own map instance, and reaches the node view
 * through exactly one callback.
 */

import { parseMavlinkNodeId, systemKey } from '@flight-path-hud/gcs-core'
import { useCallback, useRef } from 'react'
import { BASEMAPS, type TileSource } from '../map/tileSource'
import { BasemapControl, MaxZoomReadout } from '../map/BasemapControl'
import { FleetMap, type FleetMapHandle } from '../map/FleetMap'
import { LinkPanel } from '../LinkPanel'
import type { VehicleFeedState } from '../useVehicleFeed'
import { FleetRoster } from './FleetRoster'
import { nodeColor } from './fleetColors'

interface FleetViewProps {
  feed: VehicleFeedState
  url: string
  onUrlChange: (url: string) => void
  tileSource: TileSource
  basemapId: string
  onBasemapChange: (id: string) => void
  selectedSystem: string | null
  /** Focus a node in the single-node view. Receives a systemKey, not a node id. */
  onFocusNode: (systemKey: string) => void
}

export function FleetView({
  feed,
  url,
  onUrlChange,
  tileSource,
  basemapId,
  onBasemapChange,
  selectedSystem,
  onFocusNode,
}: FleetViewProps) {
  const mapHandleRef = useRef<FleetMapHandle | null>(null)

  // Stable, so the map's marker effects don't re-run every render just because
  // the roster republished on its 500 ms timer.
  const colorOf = useCallback((nodeId: string) => nodeColor(nodeId), [])

  /*
   * Both handlers cross from the transport-neutral node id back to MAVLink's
   * own identifiers, which is the one place the two id formats meet. A node id
   * that doesn't parse belongs to a transport that has neither a system key nor
   * a MAVLink mission, so both calls are simply skipped rather than guessed at.
   */
  const focusNode = (nodeId: string) => {
    const address = parseMavlinkNodeId(nodeId)

    if (address !== null) {
      onFocusNode(systemKey(address.sysId, address.compId))
    }
  }

  const loadMission = (nodeId: string) => {
    const address = parseMavlinkNodeId(nodeId)

    if (address !== null) {
      feed.requestMission(address.sysId, address.compId)
    }
  }

  return (
    <div className="fleet-layout">
      <header className="gcs-topbar">
        <span className="app-title">Fleet</span>
        <span className="fleet-topbar-meta">
          {feed.nodes.length} node{feed.nodes.length === 1 ? '' : 's'} on the link
        </span>
      </header>

      <aside className="gcs-sidebar">
        <LinkPanel
          url={url}
          onUrlChange={onUrlChange}
          connectionState={feed.connectionState}
          frameCount={feed.frameCount}
          decodeErrorCount={feed.decodeErrorCount}
        />

        <FleetRoster
          nodes={feed.nodes}
          missions={feed.missions}
          colorOf={colorOf}
          connectionState={feed.connectionState}
          replayMode={feed.replayMode}
          selectedSystem={selectedSystem}
          onFocusNode={focusNode}
          onLoadMission={loadMission}
        />
      </aside>

      <main className="fleet-main">
        <div className="view-pane map-pane">
          <FleetMap
            ref={mapHandleRef}
            nodes={feed.nodes}
            missions={feed.missions}
            tileSource={tileSource}
            colorOf={colorOf}
            onSelectNode={focusNode}
          />

          <div className="map-controls">
            <BasemapControl
              basemaps={BASEMAPS}
              basemapId={basemapId}
              onBasemapChange={onBasemapChange}
            />

            {/*
              No Follow or Track up: both anchor the camera to one vehicle, which
              is incoherent on a map whose point is showing all of them.
            */}
            <div className="map-control-stack">
              <button
                type="button"
                title="Frame every node that has a position"
                className="segment"
                onClick={() => mapHandleRef.current?.fitFleet()}
              >
                Fit fleet
              </button>
              <MaxZoomReadout maxZoom={tileSource.maxZoom} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
