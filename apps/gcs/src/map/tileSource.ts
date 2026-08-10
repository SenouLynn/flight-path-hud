/**
 * Basemap catalogue and tile configuration.
 *
 * This is the seam that keeps the Pi target's "no cloud dependency" rule
 * satisfiable by configuration rather than a rewrite: point `tiles` at a locally
 * served tile tree and nothing else changes.
 *
 * Plain data, no renderer types — the map adapter translates it, so swapping the
 * renderer does not take the catalogue with it.
 */

export interface TileSource {
  id: string
  label: string
  /**
   * Fully-expanded tile URLs. One entry per subdomain: unlike Leaflet, MapLibre
   * has no `{s}` placeholder and instead round-robins across the array.
   */
  tiles: string[]
  attribution: string
  maxZoom: number
  tileSize: number
  /** Hint for the UI; imagery basemaps want light text drawn over them. */
  dark?: boolean
}

const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors'
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri'

/** `https://{s}.host/...` with subdomains "abc" becomes three concrete URLs. */
function expandSubdomains(template: string, subdomains: string): string[] {
  return [...subdomains].map((subdomain) => template.replace('{s}', subdomain))
}

/**
 * All verified against a live tile fetch. Esri's REST services order the path
 * {z}/{y}/{x}, the reverse of the {z}/{x}/{y} every other provider here uses —
 * getting that backwards yields a map that loads but shows the wrong place.
 */
export const BASEMAPS: TileSource[] = [
  {
    id: 'streets',
    label: 'Streets (OSM)',
    tiles: expandSubdomains('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 'abc'),
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
    tileSize: 256,
  },
  {
    id: 'satellite',
    label: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 19,
    tileSize: 256,
    dark: true,
  },
  {
    id: 'topo',
    label: 'Topographic',
    tiles: expandSubdomains('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 'abc'),
    attribution: `&copy; OpenTopoMap (CC-BY-SA), ${OSM_ATTRIBUTION}`,
    maxZoom: 17,
    tileSize: 256,
  },
  {
    id: 'relief',
    label: 'Terrain relief',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 16,
    tileSize: 256,
  },
  {
    id: 'dark',
    label: 'Dark',
    tiles: expandSubdomains('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'abcd'),
    attribution: `${OSM_ATTRIBUTION}, &copy; CARTO`,
    maxZoom: 20,
    tileSize: 256,
    dark: true,
  },
  {
    id: 'light',
    label: 'Light',
    tiles: expandSubdomains('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', 'abcd'),
    attribution: `${OSM_ATTRIBUTION}, &copy; CARTO`,
    maxZoom: 20,
    tileSize: 256,
  },
]

export const DEFAULT_BASEMAP = BASEMAPS[0]

export function findBasemap(id: string): TileSource {
  return BASEMAPS.find((basemap) => basemap.id === id) ?? DEFAULT_BASEMAP
}

/**
 * Offline/self-hosted basemap. Serve a `{z}/{x}/{y}.png` tree from the same host
 * as the app — a field Pi would pre-seed its operating area — and pass this
 * instead of a catalogue entry.
 *
 * Kept out of BASEMAPS on purpose: with no tiles present it renders blank, which
 * reads as a bug rather than a configuration step.
 */
export function localTileSource(basePath = '/tiles', maxZoom = 16): TileSource {
  return {
    id: 'local',
    label: 'Local tiles',
    tiles: [`${basePath}/{z}/{x}/{y}.png`],
    attribution: 'Local tiles',
    maxZoom,
    tileSize: 256,
  }
}
