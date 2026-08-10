/**
 * Map controls overlaid on the map itself, top-right — the placement Google Maps
 * trained everyone to look for. MapLibre keeps zoom and compass at top-left, so
 * the two do not collide.
 *
 * Plain React over the map rather than a MapLibre control: keeping the renderer
 * out of the chrome means swapping it does not take the controls with it.
 */

import type { TileSource } from './tileSource'

/** Tilt used by the 3D toggle. Past ~60° the horizon dominates the frame. */
export const TILTED_PITCH_DEG = 55

interface MapControlsProps {
  basemaps: TileSource[]
  basemapId: string
  onBasemapChange: (id: string) => void
  follow: boolean
  onFollowChange: (follow: boolean) => void
  trackUp: boolean
  onTrackUpChange: (trackUp: boolean) => void
  tilted: boolean
  onTiltedChange: (tilted: boolean) => void
  onResetNorth: () => void
  maxZoom: number
}

export function MapControls({
  basemaps,
  basemapId,
  onBasemapChange,
  follow,
  onFollowChange,
  trackUp,
  onTrackUpChange,
  tilted,
  onTiltedChange,
  onResetNorth,
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

      <button
        type="button"
        title="Rotate the map so the vehicle's heading points up"
        className={trackUp ? 'segment active' : 'segment'}
        onClick={() => onTrackUpChange(!trackUp)}
        aria-pressed={trackUp}
      >
        Track up
      </button>

      <button
        type="button"
        title="Tilt the camera for a perspective view"
        className={tilted ? 'segment active' : 'segment'}
        onClick={() => onTiltedChange(!tilted)}
        aria-pressed={tilted}
      >
        3D
      </button>

      <button
        type="button"
        title="Reset bearing and tilt to north-up, flat"
        className="segment"
        onClick={onResetNorth}
      >
        North
      </button>

      <span className="map-controls-meta">max z{maxZoom}</span>
    </div>
  )
}
