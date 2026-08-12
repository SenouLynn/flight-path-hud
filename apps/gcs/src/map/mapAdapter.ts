/**
 * The map renderer's shared surface: coordinate conversion, style construction
 * and the DOM marker element factories.
 *
 * Extracted from MapPanel once a second map (FleetMap) needed the same pieces.
 * The invariant MapPanel used to state as "the only file that imports the map
 * renderer" now belongs to this directory as a whole: `maplibre-gl` is imported
 * by files under `src/map/` and nowhere else, and no MapLibre type appears in
 * any prop of any component. Replacing the renderer still means rewriting this
 * directory and nothing above it.
 *
 * COORDINATE ORDER: MapLibre is [lng, lat] — the reverse of Leaflet and of how
 * the rest of this codebase names things. Every conversion goes through
 * `toLngLat` so the flip happens in exactly one place.
 */

import type maplibregl from 'maplibre-gl'
import type { Feature, LineString } from 'geojson'
import type { TileSource } from './tileSource'

export const BASEMAP_SOURCE = 'basemap'

/** The single point where lat/lon becomes MapLibre's lng/lat. */
export function toLngLat(latDeg: number, lonDeg: number): [number, number] {
  return [lonDeg, latDeg]
}

export function buildStyle(tileSource: TileSource): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'raster',
        tiles: tileSource.tiles,
        tileSize: tileSource.tileSize,
        maxzoom: tileSource.maxZoom,
        attribution: tileSource.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0a0e14' } },
      { id: 'basemap', type: 'raster', source: BASEMAP_SOURCE },
    ],
  }
}

/** Seed value for any GeoJSON line source, before it has anything to draw. */
export function emptyFeature(): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
}

/** The single-vehicle amber, and the fallback whenever no node colour applies. */
export const DEFAULT_VEHICLE_COLOR = '#ffb454'

/**
 * Nose-up triangle; heading is applied as a marker rotation, not a redraw.
 *
 * The colour is a parameter so a fleet map can tell its nodes apart, and it
 * defaults to the single-node amber so MapPanel's appearance is unchanged.
 */
export function createVehicleMarkerElement(color: string = DEFAULT_VEHICLE_COLOR): HTMLElement {
  const element = document.createElement('div')
  element.className = 'vehicle-marker'
  element.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28">
    <polygon points="14,3 21,24 14,19 7,24" fill="${color}" stroke="#1b1b1b" stroke-width="1.5" stroke-linejoin="round" />
  </svg>`
  return element
}

/** Diamond, not the nose-triangle: home has no heading, so nothing here rotates. */
export function createHomeMarkerElement(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'home-marker'
  element.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24">
    <polygon points="12,2 22,12 12,22 2,12" fill="#57e389" stroke="#1b1b1b" stroke-width="1.5" stroke-linejoin="round" />
  </svg>`
  return element
}

/**
 * A numbered badge, not a data-driven circle layer: MapLibre can only draw
 * `text-field` symbols against server-hosted glyph PBFs (a `glyphs` URL in the
 * style), and this app's Pi target deliberately avoids any dependency on a
 * hosted service it isn't self-serving (ADR-0024's "no cloud dependency" rule
 * — the same reason 3D terrain and vector-tile buildings are deferred). Plain
 * DOM text sidesteps that entirely, at the cost of one marker per waypoint
 * instead of one GPU-batched layer — fine at mission-plan scale (tens of
 * waypoints, not thousands).
 *
 * `color` is optional rather than defaulted: leaving it unset leaves the
 * `.waypoint-marker` stylesheet rule in charge, which is what the single-node
 * map wants. A fleet map passes its node's colour to tell one plan's badges from
 * another's, because CSS cannot be parameterised per node.
 */
export function createWaypointMarkerElement(
  seq: number,
  active: boolean,
  color?: string,
): HTMLElement {
  const element = document.createElement('div')
  element.textContent = String(seq)
  styleWaypointMarker(element, active, color)
  return element
}

/**
 * Applies the class and colour an already-mounted waypoint badge should carry.
 * Shared with the factory above so a badge looks the same however it got there.
 *
 * The active highlight deliberately wins over the node colour. An inline
 * background outranks any class rule, so keeping one set would hide
 * `.waypoint-marker.active` entirely and the operator would lose track of which
 * waypoint the vehicle is flying to. Identity is worth less than state here:
 * which node a badge belongs to is also carried by its route line and its
 * position, whereas "this one is next" has no other tell.
 */
export function styleWaypointMarker(
  element: HTMLElement,
  active: boolean,
  color?: string,
): void {
  element.className = active ? 'waypoint-marker active' : 'waypoint-marker'
  // Empty string removes the inline declaration and hands the badge back to the
  // stylesheet, rather than pinning it to a wrong colour.
  element.style.background = active || color === undefined ? '' : color
}
