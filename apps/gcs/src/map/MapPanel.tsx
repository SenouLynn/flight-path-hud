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
import type { HomePosition, MissionPlan, TrackPoint, VehicleState } from '@flight-path-hud/gcs-core'
import { EMPTY_MISSION } from '@flight-path-hud/gcs-core'
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
  /**
   * Fired the moment the operator reaches for the camera — on mousedown, before
   * any movement. The app hands the camera over rather than refusing the gesture,
   * so a drag always does something.
   */
  onCameraGrab?: () => void
  /** Fired when the operator tilts by hand, so the 3D toggle cannot lie. */
  onUserPitch?: () => void
  /** Planned route: rendered as a dashed line plus per-waypoint markers. */
  mission?: MissionPlan
  /**
   * Rally/launch point. Per-system: a `null` here means "no home for the
   * currently-selected system" (different system, or a swept-stale one), so it
   * clears any marker left over from whichever system was shown before.
   */
  home?: HomePosition | null
}

/** Imperative surface for chrome that lives outside this component. */
export interface MapHandle {
  resetNorth: () => void
  /** One-off animated recentre — e.g. the operator clicked a waypoint row. */
  panTo: (latDeg: number, lonDeg: number) => void
}

const BASEMAP_SOURCE = 'basemap'
const TRACK_SOURCE = 'track'
const TRACK_LAYER = 'track-line'
const ROUTE_SOURCE = 'route'
const ROUTE_LAYER = 'route-line'

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

/** Diamond, not the nose-triangle: home has no heading, so nothing here rotates. */
function createHomeMarkerElement(): HTMLElement {
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
 */
function createWaypointMarkerElement(seq: number, active: boolean): HTMLElement {
  const element = document.createElement('div')
  element.className = active ? 'waypoint-marker active' : 'waypoint-marker'
  element.textContent = String(seq)
  return element
}

/**
 * Writes the route line into the source `addOverlayLayers` created. Split out
 * from the `[mission.items]` effect so there is one place that knows "what the
 * route source should currently contain" — called both from that effect and
 * right after a basemap swap re-adds the (now-empty) source, so the route
 * reappears immediately instead of waiting for `mission.items`' array identity
 * to change (it never does on a basemap swap, since the mission itself hasn't
 * changed).
 *
 * Waypoint markers are NOT written here — they are DOM markers (see
 * `createWaypointMarkerElement`), which live outside the style MapLibre tears
 * down on `setStyle`, so they need no re-seeding after a basemap swap at all.
 */
function syncRouteSource(map: maplibregl.Map, mission: MissionPlan): void {
  const routeSource = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (routeSource === undefined) {
    return
  }

  const items = [...mission.items].sort((a, b) => a.seq - b.seq)

  routeSource.setData({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: items.map((item) => toLngLat(item.latDeg, item.lonDeg)),
    },
  })
}

/**
 * Track + route sources/layers, added identically on first load and again
 * after every basemap swap (setStyle tears down and rebuilds the whole style,
 * sources included). Factored once both callers needed both.
 */
function addOverlayLayers(map: maplibregl.Map): void {
  map.addSource(TRACK_SOURCE, { type: 'geojson', data: emptyTrack() })
  map.addLayer({
    id: TRACK_LAYER,
    type: 'line',
    source: TRACK_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#74d7ff', 'line-width': 2.5, 'line-opacity': 0.9 },
  })

  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: emptyTrack() })
  map.addLayer({
    id: ROUTE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#c792ea',
      'line-width': 2.5,
      'line-opacity': 0.9,
      'line-dasharray': [2, 2],
    },
  })
}

export const MapPanel = forwardRef<MapHandle, MapPanelProps>(function MapPanel(
  {
    vehicle,
    track,
    tileSource,
    follow = true,
    trackUp = false,
    pitchDeg = 0,
    initialZoom = 16,
    onCameraGrab,
    onUserPitch,
    mission = EMPTY_MISSION,
    home = null,
  },
  handleRef,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null)
  // Waypoint number badges, keyed by seq — DOM markers, not a style layer, so
  // they survive a basemap swap untouched (see createWaypointMarkerElement).
  const waypointMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map())
  const loadedRef = useRef(false)
  const hasCentredRef = useRef(false)
  // Read by the ResizeObserver, which outlives any single render.
  const followRef = useRef(follow)
  const positionRef = useRef<[number, number] | null>(null)
  // Read by the 'load' and 'styledata' handlers below, which fire from MapLibre's
  // own event loop rather than a render — they need the latest mission even though
  // `mission.items`' array identity hasn't changed (see syncRouteSource).
  const missionRef = useRef(mission)

  followRef.current = follow
  missionRef.current = mission

  // The map outlives any render, so its listeners read handlers through refs.
  const handlersRef = useRef({ onCameraGrab, onUserPitch })
  handlersRef.current = { onCameraGrab, onUserPitch }

  // Rotation belongs to the map, but the button that resets it lives in the
  // chrome outside. Exposing one method keeps MapLibre from leaking upward.
  useImperativeHandle(handleRef, () => ({
    resetNorth: () => {
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 300 })
    },
    panTo: (latDeg: number, lonDeg: number) => {
      mapRef.current?.easeTo({ center: toLngLat(latDeg, lonDeg), duration: 300 })
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

    /*
     * `originalEvent` is present only for gestures, absent for our own jumpTo /
     * easeTo. That is what separates "the operator grabbed the map" from "we
     * moved it ourselves", so the release fires on the former only.
     */
    /*
     * mousedown, not dragstart: the handover has to land before MapLibre starts
     * moving anything, otherwise the app's per-frame jumpTo fights the first few
     * pixels of the drag. Reaching for the map is enough to mean it.
     */
    const grab = () => {
      handlersRef.current.onCameraGrab?.()
    }

    const canvas = map.getCanvas()
    canvas.addEventListener('mousedown', grab)
    canvas.addEventListener('touchstart', grab, { passive: true })

    map.on('pitchstart', (event) => {
      if (event.originalEvent) {
        handlersRef.current.onUserPitch?.()
      }
    })

    map.on('load', () => {
      loadedRef.current = true
      addOverlayLayers(map)
      // Covers the mount-order race: a cached mission frame can land before
      // 'load' fires, in which case the [mission.items] effect below already
      // ran and found no route source to write into. Seed from the ref now.
      // Waypoint markers have no such race — they're DOM markers, addable as
      // soon as the map instance exists, independent of the style loading.
      syncRouteSource(map, missionRef.current)
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
      canvas.removeEventListener('mousedown', grab)
      canvas.removeEventListener('touchstart', grab)
      observer.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
      homeMarkerRef.current = null
      waypointMarkersRef.current.forEach((marker) => marker.remove())
      waypointMarkersRef.current = new Map()
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

      addOverlayLayers(map)
      // setStyle tears down every source, including the route. Re-adding it
      // via addOverlayLayers leaves it empty; mission.items' array identity is
      // unchanged by a basemap swap, so the [mission.items] effect below never
      // re-fires to refill it. Re-seed from the ref right here so the route
      // line doesn't vanish until the operator re-clicks "Load mission".
      // Waypoint markers are unaffected by setStyle entirely — they're DOM
      // elements outside the style, not a source/layer it tears down.
      syncRouteSource(map, missionRef.current)
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
      return
    }

    /*
     * Follow owns the centre; track-up owns the bearing. They are independent —
     * rotating to the vehicle's heading around a centre the operator chose is a
     * perfectly reasonable view, and making one depend on the other is what made
     * track-up look broken with follow off.
     *
     * Both ride in one jumpTo: two moves per frame means two renders and a
     * visible shear between the pan and the rotation. jumpTo, not easeTo, because
     * frames arrive ~33x a second and an animated move is torn down long before
     * it finishes.
     */
    const move: { center?: [number, number], bearing?: number } = {}

    if (follow) {
      move.center = position
    }

    // Bearing is the compass direction that is "up", so setting it to the heading
    // puts the nose at the top of the screen.
    if (trackUp && vehicle.headingDeg !== null) {
      move.bearing = vehicle.headingDeg
    }

    /*
     * jumpTo is instantaneous — it stops whatever animation MapLibre is
     * currently running before applying its own transform, no matter how far
     * that animation had gotten. Frames arrive up to ~33x a second, so an
     * unguarded jumpTo here cancels any operator-triggered eased move (the
     * NavigationControl's +/- zoom buttons, "Reset view", the tilt toggle)
     * within a single frame — the zoom looks like it "bails out" because it
     * usually does, one frame into its ~300ms animation.
     *
     * isMoving() is true only while such an animation is actually in flight;
     * jumpTo itself never sets it. Skipping the recentre for the handful of
     * frames an animation runs is imperceptible, and follow simply resumes on
     * the next frame after it finishes — the same "get out of the way" idea
     * as handing the camera over on a manual drag, just for a shorter reach.
     */
    if ((move.center !== undefined || move.bearing !== undefined) && !map.isMoving()) {
      map.jumpTo(move)
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

  // Route line. The wire order is not guaranteed to match flight order, so
  // syncRouteSource sorts by `seq` before building the line.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    syncRouteSource(map, mission)
  }, [mission.items])

  /*
   * Waypoint number badges: one DOM marker per mission item, keyed by `seq`
   * (not array index — wire order is not guaranteed to match flight order,
   * and `seq` is also what `activeIndex` refers to). Diffed against the
   * previous render rather than torn down and rebuilt wholesale, so an
   * unrelated field changing elsewhere in `mission` doesn't flash every pin.
   *
   * Depends on `mission.activeIndex` explicitly, not just `mission.items`:
   * `missionPlanFromFrame` happens to always return a fresh `items` array
   * whenever any field changes (so an activeIndex-only update would still
   * re-run this effect even without the explicit dependency), but that's an
   * upstream implementation detail this file shouldn't have to lean on to be
   * correct.
   */
  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    const markers = waypointMarkersRef.current
    const seenSeqs = new Set<number>()

    mission.items.forEach((item) => {
      seenSeqs.add(item.seq)
      const active = item.seq === mission.activeIndex
      const position = toLngLat(item.latDeg, item.lonDeg)
      const existing = markers.get(item.seq)

      if (existing === undefined) {
        const marker = new maplibregl.Marker({ element: createWaypointMarkerElement(item.seq, active) })
          .setLngLat(position)
          .addTo(map)
        markers.set(item.seq, marker)
        return
      }

      existing.setLngLat(position)
      existing.getElement().className = active ? 'waypoint-marker active' : 'waypoint-marker'
    })

    // Drop markers for waypoints no longer in the mission — a shorter reload,
    // or switching to a system with a different (or no) plan.
    markers.forEach((marker, seq) => {
      if (!seenSeqs.has(seq)) {
        marker.remove()
        markers.delete(seq)
      }
    })
  }, [mission.items, mission.activeIndex])

  // Home marker: per-system, so a `null` (different system, or the previous
  // one swept as stale) must clear whatever marker is on screen — otherwise
  // switching to a system with no home yet shows the last system's home,
  // silently misattributed to the newly selected vehicle.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    if (home === null) {
      homeMarkerRef.current?.remove()
      homeMarkerRef.current = null
      return
    }

    const position = toLngLat(home.latDeg, home.lonDeg)

    if (homeMarkerRef.current === null) {
      homeMarkerRef.current = new maplibregl.Marker({ element: createHomeMarkerElement() })
        .setLngLat(position)
        .addTo(map)
    } else {
      homeMarkerRef.current.setLngLat(position)
    }
  }, [home])

  return <div ref={containerRef} className="map-panel" />
})
