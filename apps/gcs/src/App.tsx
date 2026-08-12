/**
 * The shell. It owns the telemetry feed and switches between the two views.
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

  const feed = useVehicleFeed({ url, selectedSystem })
  const tileSource = useMemo(() => findBasemap(basemapId), [basemapId])

  /*
   * The whole seam between the two views. Pinning `selectedSystem` rather than
   * leaving it on "Auto (latest)" is what makes this "focus this node" instead
   * of "show whichever node reported most recently" — which, on a live fleet,
   * would be a different aircraft a moment later.
   */
  const focusNode = (system: string) => {
    setSelectedSystem(system)
    setAppView('node')
  }

  if (appView === 'fleet') {
    return (
      <FleetView
        feed={feed}
        url={url}
        onUrlChange={setUrl}
        tileSource={tileSource}
        basemapId={basemapId}
        onBasemapChange={setBasemapId}
        selectedSystem={selectedSystem}
        onFocusNode={focusNode}
      />
    )
  }

  return (
    <NodeView
      feed={feed}
      url={url}
      onUrlChange={setUrl}
      selectedSystem={selectedSystem}
      onSelectSystem={setSelectedSystem}
      tileSource={tileSource}
      basemapId={basemapId}
      onBasemapChange={setBasemapId}
      onBackToFleet={() => setAppView('fleet')}
    />
  )
}

export default App
