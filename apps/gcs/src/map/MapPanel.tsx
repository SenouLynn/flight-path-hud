/**
 * THE ONLY FILE THAT IMPORTS THE MAP RENDERER.
 *
 * Everything it needs arrives as plain data — vehicle state, an array of lat/lon
 * points, a tile config — so replacing the renderer means rewriting this component
 * and nothing else. No MapLibre type may appear in any prop.
 *
 * Imperative on purpose: MapLibre owns a WebGL canvas and mutates sources in
 * place, so React renders an empty container once and updates happen in effects
 * against refs.
 *
 * COORDINATE ORDER: MapLibre is [lng, lat] — the reverse of Leaflet and of how
 * the rest of this codebase names things. Every conversion goes through
 * `toLngLat` so the flip happens in exactly one place.
 */

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Feature, LineString } from 'geojson'
import type { TrackPoint, VehicleState } from '@flight-path-hud/gcs-core'
import type { TileSource } from './tileSource'

interface MapPanelProps {
  vehicle: VehicleState | null
  track: TrackPoint[]
  tileSource: TileSource
  /** Keep the map centred on the vehicle as it moves. */
  follow?: boolean
  /** Rotate the map so the vehicle's heading points up, rather than north. */
  trackUp?: boolean
  /**
   * Camera tilt. Works on the raster basemaps as a perspective view; real 3D
   * terrain additionally needs a raster-DEM source (not wired up).
   */
  pitchDeg?: number
  initialZoom?: number
}

/** Imperative surface for chrome that lives outside this component. */
export interface MapHandle {
  resetNorth: () => void
}

const BASEMAP_SOURCE = 'basemap'
const TRACK_SOURCE = 'track'
const TRACK_LAYER = 'track-line'

/** The single point where lat/lon becomes MapLibre's lng/lat. */
function toLngLat(latDeg: number, lonDeg: number): [number, number] {
  return [lonDeg, latDeg]
}

function buildStyle(tileSource: TileSource): maplibregl.StyleSpecification {
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

function emptyTrack(): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
}

/** Nose-up triangle; heading is applied as a marker rotation, not a redraw. */
function createMarkerElement(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'vehicle-marker'
  element.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28">
    <polygon points="14,3 21,24 14,19 7,24" fill="#ffb454" stroke="#1b1b1b" stroke-width="1.5" stroke-linejoin="round" />
  </svg>`
  return element
}

export const MapPanel = forwardRef<MapHandle, MapPanelProps>(function MapPanel(
  { vehicle, track, tileSource, follow = true, trackUp = false, pitchDeg = 0, initialZoom = 16 },
  handleRef,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const loadedRef = useRef(false)
  const hasCentredRef = useRef(false)
  // Read by the ResizeObserver, which outlives any single render.
  const followRef = useRef(follow)
  const positionRef = useRef<[number, number] | null>(null)

  followRef.current = follow

  // Rotation belongs to the map, but the button that resets it lives in the
  // chrome outside. Exposing one method keeps MapLibre from leaking upward.
  useImperativeHandle(handleRef, () => ({
    resetNorth: () => {
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 300 })
    },
  }), [])

  // Create the map once. MapLibre owns this subtree; React must not touch it.
  useEffect(() => {
    if (containerRef.current === null) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(tileSource),
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: true },
      // Rotation is the reason we are on MapLibre; make sure every input can do it.
      dragRotate: true,
      pitchWithRotate: true,
    })
    mapRef.current = map

    // Zoom + compass. The compass rotates by dragging and resets north on click,
    // which is the control Leaflet could not offer at all.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left')

    map.on('load', () => {
      loadedRef.current = true
      map.addSource(TRACK_SOURCE, { type: 'geojson', data: emptyTrack() })
      map.addLayer({
        id: TRACK_LAYER,
        type: 'line',
        source: TRACK_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#74d7ff', 'line-width': 2.5, 'line-opacity': 0.9 },
      })
    })

    // MapLibre reads its container size on creation and on window resize only.
    // Toggling a column changes our width without one.
    const observer = new ResizeObserver(() => {
      map.resize()

      // Re-centring is the follow effect's job; replay it here so a resize and
      // follow never end up as two owners of the centre.
      if (followRef.current && positionRef.current !== null) {
        map.jumpTo({ center: positionRef.current })
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      loadedRef.current = false
      hasCentredRef.current = false
    }
    // Style is swapped in its own effect; this must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the basemap. setStyle replaces sources and layers, so the track is re-added.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !loadedRef.current) {
      return
    }

    map.setStyle(buildStyle(tileSource))
    map.once('styledata', () => {
      if (map.getSource(TRACK_SOURCE) !== undefined) {
        return
      }

      map.addSource(TRACK_SOURCE, { type: 'geojson', data: emptyTrack() })
      map.addLayer({
        id: TRACK_LAYER,
        type: 'line',
        source: TRACK_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#74d7ff', 'line-width': 2.5, 'line-opacity': 0.9 },
      })
    })
  }, [tileSource])

  // Camera tilt.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || Math.abs(map.getPitch() - pitchDeg) < 0.5) {
      return
    }

    // Animated here, unlike the per-frame follow: this is a one-off the operator
    // asked for, so it should read as a move rather than a jump.
    map.easeTo({ pitch: pitchDeg, duration: 350 })
  }, [pitchDeg])

  // Vehicle marker: position and heading.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || vehicle === null || vehicle.latDeg === null || vehicle.lonDeg === null) {
      return
    }

    const position = toLngLat(vehicle.latDeg, vehicle.lonDeg)
    positionRef.current = position

    if (markerRef.current === null) {
      markerRef.current = new maplibregl.Marker({ element: createMarkerElement() })
        .setLngLat(position)
        .addTo(map)
    } else {
      markerRef.current.setLngLat(position)
    }

    // Rotate with the map so the nose points at the true heading even when the
    // view is rotated away from north.
    markerRef.current.setRotationAlignment('map')
    markerRef.current.setRotation(vehicle.headingDeg ?? 0)
    markerRef.current.getElement().style.opacity = vehicle.headingDeg === null ? '0.45' : '1'

    if (!hasCentredRef.current) {
      map.jumpTo({ center: position, zoom: Math.min(initialZoom, tileSource.maxZoom) })
      hasCentredRef.current = true
    } else if (follow) {
      /*
       * jumpTo, not easeTo. Frames arrive ~33x a second, so an animated move is
       * torn down and restarted long before it finishes — the map perpetually
       * starts moving and never arrives. Stepping straight there is smooth at
       * this rate because the steps are sub-metre.
       *
       * Bearing rides along in the same call: two separate moves per frame would
       * mean two renders and a visible shear between the pan and the rotation.
       */
      map.jumpTo(
        trackUp && vehicle.headingDeg !== null
          // Bearing is the compass direction that is "up", so setting it to the
          // heading puts the nose at the top of the screen.
          ? { center: position, bearing: vehicle.headingDeg }
          : { center: position },
      )
    }
  }, [vehicle, follow, trackUp, initialZoom, tileSource.maxZoom])

  // Breadcrumb trail.
  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (source === undefined) {
      return
    }

    source.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: track.map((point) => toLngLat(point.latDeg, point.lonDeg)),
      },
    })
  }, [track])

  return <div ref={containerRef} className="map-panel" />
})
