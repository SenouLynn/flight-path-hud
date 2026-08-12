/**
 * The basemap picker and max-zoom readout, shared by every map.
 *
 * Split out of MapControls because the fleet map wants exactly these two pieces
 * and none of the vehicle-anchored toggles beside them: Follow and Track up are
 * statements about *one* vehicle, and have no meaning on a map showing all of
 * them.
 */

import type { TileSource } from './tileSource'

interface BasemapControlProps {
  basemaps: TileSource[]
  basemapId: string
  onBasemapChange: (id: string) => void
}

export function BasemapControl({ basemaps, basemapId, onBasemapChange }: BasemapControlProps) {
  return (
    <select
      value={basemapId}
      onChange={(event) => onBasemapChange(event.target.value)}
      aria-label="Basemap"
    >
      {basemaps.map((basemap) => (
        <option key={basemap.id} value={basemap.id}>{basemap.label}</option>
      ))}
    </select>
  )
}

/** The zoom ceiling of whichever basemap is active. Purely informational. */
export function MaxZoomReadout({ maxZoom }: { maxZoom: number }) {
  return <span className="map-controls-meta">max z{maxZoom}</span>
}
