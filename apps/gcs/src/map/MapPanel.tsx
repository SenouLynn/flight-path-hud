/**
 * THE ONLY FILE THAT IMPORTS LEAFLET.
 *
 * Leaflet is a stand-in renderer. Everything it needs arrives as plain data —
 * vehicle state, an array of lat/lon points, a tile config — so replacing it
 * (MapLibre, a canvas renderer, whatever a Pi build wants) means rewriting this
 * component and nothing else. No Leaflet type may appear in any prop.
 *
 * The adapter is imperative on purpose: Leaflet owns its own DOM and mutates
 * layers in place, so React renders an empty container once and layer updates
 * happen in effects against refs.
 */

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { TrackPoint, VehicleState } from '@flight-path-hud/gcs-core'
import type { TileSource } from './tileSource'

interface MapPanelProps {
  vehicle: VehicleState | null
  track: TrackPoint[]
  tileSource: TileSource
  /** Keep the map centred on the vehicle as it moves. */
  follow?: boolean
  initialZoom?: number
}

const TRACK_STYLE = { color: '#74d7ff', weight: 2.5, opacity: 0.9 }

/** Nose-up triangle so the marker shows heading, rotated by CSS. */
function vehicleIcon(headingDeg: number | null): L.DivIcon {
  const rotation = headingDeg ?? 0
  const dimmed = headingDeg === null ? 0.45 : 1

  return L.divIcon({
    className: 'vehicle-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<svg width="28" height="28" viewBox="0 0 28 28" style="transform: rotate(${rotation}deg); opacity: ${dimmed}">
      <polygon points="14,3 21,24 14,19 7,24" fill="#ffb454" stroke="#1b1b1b" stroke-width="1.5" stroke-linejoin="round" />
    </svg>`,
  })
}

export function MapPanel({ vehicle, track, tileSource, follow = true, initialZoom = 16 }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const trackRef = useRef<L.Polyline | null>(null)
  const hasCentredRef = useRef(false)

  // Create the map once. Leaflet manages this subtree; React must not touch it.
  useEffect(() => {
    if (containerRef.current === null) {
      return
    }

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
    map.setView([0, 0], 2)
    mapRef.current = map
    trackRef.current = L.polyline([], TRACK_STYLE).addTo(map)

    // Leaflet caches its container size and only re-reads it on window resize.
    // Toggling the HUD column changes our width without one, which would leave
    // the map rendering into stale bounds (grey gutters, wrong hit-testing).
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      trackRef.current = null
      hasCentredRef.current = false
    }
  }, [])

  // Swap the basemap whenever the tile source changes.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    // Layers cap out at different zooms (relief at 16, topo at 17, CARTO at 20).
    // Staying zoomed past the new layer's max leaves the map blank.
    if (map.getZoom() > tileSource.maxZoom) {
      map.setZoom(tileSource.maxZoom)
    }

    const layer = L.tileLayer(tileSource.urlTemplate, {
      attribution: tileSource.attribution,
      maxZoom: tileSource.maxZoom,
      subdomains: tileSource.subdomains ?? 'abc',
    }).addTo(map)

    return () => {
      layer.remove()
    }
  }, [tileSource])

  // Vehicle marker: position and heading.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || vehicle === null || vehicle.latDeg === null || vehicle.lonDeg === null) {
      return
    }

    const position: L.LatLngExpression = [vehicle.latDeg, vehicle.lonDeg]

    if (markerRef.current === null) {
      markerRef.current = L.marker(position, { icon: vehicleIcon(vehicle.headingDeg) }).addTo(map)
    } else {
      markerRef.current.setLatLng(position)
      markerRef.current.setIcon(vehicleIcon(vehicle.headingDeg))
    }

    // Zoom in properly on the first real fix, then just follow.
    if (!hasCentredRef.current) {
      // getMaxZoom() reflects the active layer, so this can't overshoot it.
      map.setView(position, Math.min(initialZoom, map.getMaxZoom()))
      hasCentredRef.current = true
    } else if (follow) {
      map.panTo(position, { animate: true, duration: 0.25 })
    }
  }, [vehicle, follow, initialZoom])

  // Breadcrumb trail.
  useEffect(() => {
    trackRef.current?.setLatLngs(track.map((point) => [point.latDeg, point.lonDeg] as L.LatLngExpression))
  }, [track])

  return <div ref={containerRef} className="map-panel" />
}
