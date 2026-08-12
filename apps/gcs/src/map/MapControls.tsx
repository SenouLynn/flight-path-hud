/**
 * Map controls overlaid on the map itself, top-right — the placement Google Maps
 * trained everyone to look for. MapLibre keeps zoom and compass at top-left, so
 * the two do not collide.
 *
 * Plain React over the map rather than a MapLibre control: keeping the renderer
 * out of the chrome means swapping it does not take the controls with it.
 */

import { BasemapControl, MaxZoomReadout } from './BasemapControl'
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
  onResetView: () => void
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
  onResetView,
  maxZoom,
}: MapControlsProps) {
  return (
    <div className="map-controls">
      <BasemapControl
        basemaps={basemaps}
        basemapId={basemapId}
        onBasemapChange={onBasemapChange}
      />

      <button
        type="button"
        title="Keep the map centred on the vehicle. Reaching for the map hands the camera back to you."
        className={follow ? 'segment active' : 'segment'}
        onClick={() => onFollowChange(!follow)}
        aria-pressed={follow}
      >
        Follow
      </button>

      <button
        type="button"
        title="Rotate the map so the vehicle's heading points up. Turns Follow on, since orienting to a vehicle you are not centred on is meaningless."
        className={trackUp ? 'segment active' : 'segment'}
        onClick={() => onTrackUpChange(!trackUp)}
        aria-pressed={trackUp}
      >
        Track up
      </button>

      <button
        type="button"
        title="Tilt the camera to look around. Exclusive with Follow and Track up, which re-anchor the camera every frame."
        className={tilted ? 'segment active' : 'segment'}
        onClick={() => onTiltedChange(!tilted)}
        aria-pressed={tilted}
      >
        3D
      </button>

      {/* The zoom readout hangs under the last button rather than extending the row. */}
      <div className="map-control-stack">
        <button
          type="button"
          title="Point the map north and remove tilt"
          className="segment"
          onClick={onResetView}
        >
          Reset view
        </button>
        <MaxZoomReadout maxZoom={maxZoom} />
      </div>
    </div>
  )
}
