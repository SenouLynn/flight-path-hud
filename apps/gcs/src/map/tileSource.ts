/**
 * Basemap catalogue and tile configuration.
 *
 * This is the seam that keeps the Pi target's "no cloud dependency" rule
 * satisfiable by configuration rather than a rewrite: point `urlTemplate` at a
 * locally served tile tree and nothing else changes.
 *
 * Plain data, no Leaflet types — the renderer translates it, so the picker
 * survives swapping Leaflet out.
 */

export interface TileSource {
  id: string
  label: string
  urlTemplate: string
  attribution: string
  maxZoom: number
  subdomains?: string
  /** Hint for the UI; imagery basemaps want light text drawn over them. */
  dark?: boolean
}

const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors'
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri'

/**
 * All verified against a live tile fetch. Esri's REST services order the path
 * {z}/{y}/{x}, the reverse of the {z}/{x}/{y} every other provider here uses —
 * getting that backwards yields a map that loads but shows the wrong place.
 */
export const BASEMAPS: TileSource[] = [
  {
    id: 'streets',
    label: 'Streets (OSM)',
    urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
    subdomains: 'abc',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 19,
    dark: true,
  },
  {
    id: 'topo',
    label: 'Topographic',
    urlTemplate: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `&copy; OpenTopoMap (CC-BY-SA), ${OSM_ATTRIBUTION}`,
    maxZoom: 17,
    subdomains: 'abc',
  },
  {
    id: 'relief',
    label: 'Terrain relief',
    urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 16,
  },
  {
    id: 'dark',
    label: 'Dark',
    urlTemplate: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTRIBUTION}, &copy; CARTO`,
    maxZoom: 20,
    subdomains: 'abcd',
    dark: true,
  },
  {
    id: 'light',
    label: 'Light',
    urlTemplate: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTRIBUTION}, &copy; CARTO`,
    maxZoom: 20,
    subdomains: 'abcd',
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
    urlTemplate: `${basePath}/{z}/{x}/{y}.png`,
    attribution: 'Local tiles',
    maxZoom,
  }
}
