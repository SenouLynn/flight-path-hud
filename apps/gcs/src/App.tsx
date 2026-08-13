/**
 * The shell. It owns the telemetry feed, the global header, and the switch
 * between the two views.
 *
 * The information architecture is list → detail: the fleet roster is the
 * outermost view, and the single-node UI is what you get when you focus one of
 * its nodes. No router — this is a kiosk-style app with two views and no URLs to
 * address them by.
 *
 * The feed is deliberately here rather than in either view. `useVehicleFeed`'s
 * cleanup stops the WebSocket and resets every per-system fold, so a feed owned
 * by a view would drop the link, the trails and every cached mission each time
 * the operator navigated. Owning it above the switch means only the inactive
 * view unmounts — which also keeps exactly one MapLibre context alive at a time.
 *
 * The header is global for the same reason the feed is: the app's identity and
 * the scope picker do not belong to either view. Each view contributes its own
 * chrome to a subbar beneath it.
 */

import { useMemo, useState } from 'react'
import { FleetView } from './fleet/FleetView'
import { DEFAULT_BASEMAP, findBasemap } from './map/tileSource'
import { NodeView } from './NodeView'
import { useVehicleFeed } from './useVehicleFeed'

const DEFAULT_URL = 'ws://localhost:8080/telemetry'

type AppView = 'fleet' | 'node'

function App() {
  const [url, setUrl] = useState(DEFAULT_URL)
  // Fleet first: it is the view that shows whether anything is on the link at
  // all, which is the question an operator has before any other.
  const [appView, setAppView] = useState<AppView>('fleet')
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null)
  // Shared by both maps on purpose — the operator's choice of basemap is about
  // the ground, not about which view they happen to be looking at.
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id)
  /*
   * Nodes the operator has hidden from the fleet map, by node id. Held here
   * rather than in FleetView so that stepping into a node's detail and back does
   * not silently restore everything they just cleared off the picture.
   *
   * Hidden means hidden *on the map only* — the roster still lists them, which
   * is what makes the eye a toggle rather than a filter.
   */
  const [hiddenNodeIds, setHiddenNodeIds] = useState<ReadonlySet<string>>(new Set())

  const feed = useVehicleFeed({ url, selectedSystem })
  const tileSource = useMemo(() => findBasemap(basemapId), [basemapId])

  const toggleNodeHidden = (nodeId: string) => {
    setHiddenNodeIds((previous) => {
      const next = new Set(previous)

      if (!next.delete(nodeId)) {
        next.add(nodeId)
      }

      return next
    })
  }

  /*
   * The whole seam between the two views. Pinning `selectedSystem` is what makes
   * this "focus this node" rather than "show whichever node reported most
   * recently" — which, on a live fleet, would be a different aircraft a moment
   * later.
   */
  const focusNode = (system: string) => {
    setSelectedSystem(system)
    setAppView('node')
  }

  // A node view is reached only through focusNode/changeScope, both of which pin
  // a concrete system. There is intentionally no "latest frame wins" detail
  // mode: a live multi-vehicle link would make the screen ping-pong between nodes.
  const scopedSystem = appView === 'node' ? selectedSystem : null

  const changeScope = (system: string | null) => {
    if (system === null) {
      setAppView('fleet')
      return
    }

    focusNode(system)
  }

  return (
    <div className="app-shell">
      <header className="gcs-topbar">
        <span className="app-title">Ground control</span>
      </header>

      {appView === 'fleet' ? (
        <FleetView
          feed={feed}
          url={url}
          onUrlChange={setUrl}
          tileSource={tileSource}
          basemapId={basemapId}
          onBasemapChange={setBasemapId}
          selectedSystem={selectedSystem}
          hiddenNodeIds={hiddenNodeIds}
          onToggleNodeHidden={toggleNodeHidden}
          onFocusNode={focusNode}
        />
      ) : (
        <NodeView
          feed={feed}
          url={url}
          onUrlChange={setUrl}
          tileSource={tileSource}
          basemapId={basemapId}
          onBasemapChange={setBasemapId}
          onBackToFleet={() => setAppView('fleet')}
          onScopeChange={changeScope}
          selectedSystem={scopedSystem}
        />
      )}
    </div>
  )
}

export default App
