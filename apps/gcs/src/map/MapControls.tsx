/**
 * Map controls overlaid on the map itself, top-right — the placement Google Maps
 * trained everyone to look for. Leaflet keeps zoom at top-left, so the two do not
 * collide.
 *
 * Plain React over the map rather than an `L.Control`: keeping Leaflet out of the
 * chrome means swapping the renderer does not take the controls with it.
 */

import type { TileSource } from './tileSource'

interface MapControlsProps {
  basemaps: TileSource[]
  basemapId: string
  onBasemapChange: (id: string) => void
  follow: boolean
  onFollowChange: (follow: boolean) => void
  maxZoom: number
}

export function MapControls({
  basemaps,
  basemapId,
  onBasemapChange,
  follow,
  onFollowChange,
  maxZoom,
}: MapControlsProps) {
  return (
    <div className="map-controls">
      <select
        value={basemapId}
        onChange={(event) => onBasemapChange(event.target.value)}
        aria-label="Basemap"
      >
        {basemaps.map((basemap) => (
          <option key={basemap.id} value={basemap.id}>{basemap.label}</option>
        ))}
      </select>

      <button
        type="button"
        title="Keep the map centred on the vehicle"
        className={follow ? 'segment active' : 'segment'}
        onClick={() => onFollowChange(!follow)}
        aria-pressed={follow}
      >
        Follow
      </button>

      <span className="map-controls-meta">max z{maxZoom}</span>
    </div>
  )
}
