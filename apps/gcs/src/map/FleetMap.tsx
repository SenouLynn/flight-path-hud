/**
 * THE FLEET MAP: every node on one picture, with its own map instance.
 *
 * Deliberately a separate component from MapPanel rather than a display mode on
 * it (docs/multi_node_awareness.md). The two answer different questions — "where
 * is this aircraft going" versus "where is everyone" — and the camera rules that
 * follow from that are incompatible: Follow and Track up anchor to one vehicle,
 * which has no meaning here. Only one of the two maps is ever mounted, so this
 * costs no second live WebGL context.
 *
 * Everything it draws arrives as plain data. No MapLibre type appears in any
 * prop; the renderer, style and marker factories come from `./mapAdapter`.
 */

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { MissionPlan, NodeSummary } from '@flight-path-hud/gcs-core'
import type { FeatureCollection, LineString } from 'geojson'
import type { TileSource } from './tileSource'
import {
  buildStyle,
  createVehicleMarkerElement,
  createWaypointMarkerElement,
  styleWaypointMarker,
  toLngLat,
} from './mapAdapter'
import {
  fleetBounds,
  freshnessOpacity,
  isDrawable,
  missionFor,
  overlaySignature,
  routeFeatureCollection,
  sortedWaypoints,
} from '../fleet/fleetMapData'
import { isActiveMissionWaypoint } from '../missionPresentation'

interface FleetMapProps {
  nodes: NodeSummary[]
  /** Every known plan, keyed by systemKey. Nodes without one simply draw no route. */
  missions: ReadonlyMap<string, MissionPlan>
  tileSource: TileSource
  /** One stable colour per node id, shared with the roster. */
  colorOf: (nodeId: string) => string
  /** Focus a node — the seam to the single-node view. */
  onSelectNode?: (nodeId: string) => void
}

/** Imperative surface for chrome that lives outside this component. */
export interface FleetMapHandle {
  /** Frame every node that has a position. */
  fitFleet: () => void
  /** Recenter the current camera on one node without changing the selected detail view. */
  centerNode: (nodeId: string) => void
}

const ROUTES_SOURCE = 'fleet-routes'
const ROUTES_LAYER = 'fleet-routes-line'

/** Enough padding that a marker at the edge of the fleet isn't clipped by the frame. */
const FIT_PADDING_PX = 72
/**
 * Without a ceiling, a single node (a zero-area bounds) fits to the basemap's
 * maximum zoom, which is a rooftop view of one aircraft and no context.
 */
const FIT_MAX_ZOOM = 15

function emptyRoutes(): FeatureCollection<LineString> {
  return { type: 'FeatureCollection', features: [] }
}

/** Composite key: waypoint `seq` is only unique within one node's plan. */
function waypointKey(nodeId: string, seq: number): string {
  return `${nodeId}#${seq}`
}

/**
 * Writes the fleet's routes into the source `addRouteLayer` created. Split out
 * for the same reason MapPanel splits `syncRouteSource`: a basemap swap re-adds
 * the source empty, and the route data's identity hasn't changed, so the effect
 * that normally fills it never re-fires.
 */
function syncRoutesSource(map: maplibregl.Map, routes: FeatureCollection<LineString>): void {
  const source = map.getSource(ROUTES_SOURCE) as maplibregl.GeoJSONSource | undefined

  if (source === undefined) {
    return
  }

  source.setData(routes)
}

/**
 * One source and one layer for every node's route, coloured per feature.
 *
 * `['get', 'color']` reads the property `routeFeatureCollection` wrote, so
 * adding or removing a node changes only the data — never the style. The
 * alternative, a layer per node, would mean add/remove churn as the roster
 * changes plus re-adding all of them after every basemap swap.
 */
function addRouteLayer(map: maplibregl.Map): void {
  map.addSource(ROUTES_SOURCE, { type: 'geojson', data: emptyRoutes() })
  map.addLayer({
    id: ROUTES_LAYER,
    type: 'line',
    source: ROUTES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2.5,
      'line-opacity': 0.9,
      'line-dasharray': [2, 2],
    },
  })
}

export const FleetMap = forwardRef<FleetMapHandle, FleetMapProps>(function FleetMap(
  { nodes, missions, tileSource, colorOf, onSelectNode },
  handleRef,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Vehicle markers keyed by NodeIdentity.id, and waypoint badges by node+seq.
  // Both are DOM markers, which live in the map container rather than the style,
  // so `setStyle` leaves them alone and they need no re-seeding on a basemap swap.
  const vehicleMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const waypointMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const loadedRef = useRef(false)
  // Fit once, on the first data that can be framed. After that the camera is the
  // operator's — re-fitting on every roster tick would fight them the way Follow
  // does on the single-node map.
  const hasFittedRef = useRef(false)

  // Read by MapLibre's own event loop ('load', 'styledata'), which fires outside
  // any React render and so cannot close over the current props.
  const routesRef = useRef<FeatureCollection<LineString>>(emptyRoutes())
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const handlersRef = useRef({ onSelectNode })
  handlersRef.current = { onSelectNode }

  /*
   * The overlay effects below key on this rather than on `nodes`. The roster
   * republishes twice a second with a fresh array, and route lines and waypoint
   * badges do not move when a vehicle does — without this, every tick rebuilt
   * the whole fleet's routes and pushed them through `setData`, redrawing every
   * node's overlay at 2 Hz whether or not anything had changed.
   */
  const overlayKey = useMemo(() => overlaySignature(nodes, missions), [nodes, missions])

  // Read inside the overlay effects, which no longer re-run when `nodes` alone
  // changes identity — they still need the current roster to iterate.
  const overlayNodesRef = useRef(nodes)
  overlayNodesRef.current = nodes

  const fitFleet = () => {
    const map = mapRef.current
    const bounds = fleetBounds(nodesRef.current)

    if (map === null || bounds === null) {
      return
    }

    map.fitBounds(bounds, { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, duration: 400 })
  }

  const centerNode = (nodeId: string) => {
    const map = mapRef.current
    const node = nodesRef.current.find((candidate) => candidate.identity.id === nodeId)

    if (map === null || node === undefined || !node.hasFix || node.latDeg === null || node.lonDeg === null) {
      return
    }

    // Deliberately retain zoom and bearing: this is a recenter action, not a
    // single-node version of Fit fleet and not a change to the detail scope.
    map.easeTo({ center: [node.lonDeg, node.latDeg], duration: 400 })
  }

  useImperativeHandle(handleRef, () => ({ fitFleet, centerNode }), [])

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
      dragRotate: true,
      pitchWithRotate: true,
    })
    mapRef.current = map

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
      'top-left',
    )

    map.on('load', () => {
      loadedRef.current = true
      addRouteLayer(map)
      // Same mount-order race MapPanel guards: cached mission frames can land
      // before 'load', in which case the routes effect already ran and found no
      // source to write into.
      syncRoutesSource(map, routesRef.current)
    })

    // MapLibre reads its container size on creation and on window resize only,
    // and this app changes layout without one.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      vehicleMarkersRef.current.forEach((marker) => marker.remove())
      vehicleMarkersRef.current = new Map()
      waypointMarkersRef.current.forEach((marker) => marker.remove())
      waypointMarkersRef.current = new Map()
      loadedRef.current = false
      hasFittedRef.current = false
    }
    // Style is swapped in its own effect; this must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the basemap. setStyle tears down every source and layer, routes included.
  useEffect(() => {
    const map = mapRef.current

    if (map === null || !loadedRef.current) {
      return
    }

    map.setStyle(buildStyle(tileSource))
    map.once('styledata', () => {
      // `styledata` fires for reasons other than a full replacement, so this
      // guard keeps the re-add idempotent.
      if (map.getSource(ROUTES_SOURCE) !== undefined) {
        return
      }

      addRouteLayer(map)
      // Re-added empty, and the route data's identity is unchanged by a basemap
      // swap, so the effect below will not re-fire to refill it.
      syncRoutesSource(map, routesRef.current)
    })
  }, [tileSource])

  /*
   * Vehicle markers: one DOM marker per node, keyed by `identity.id`, diffed
   * against the previous roster rather than rebuilt. The roster republishes
   * every 500 ms whether or not anything moved, so tearing down and recreating
   * would flash every marker on the map twice a second.
   *
   * Nodes without a fix are skipped entirely — they stay in the roster, where a
   * node that exists but cannot be placed is still worth showing, but there is
   * nothing to draw here.
   */
  useEffect(() => {
    const map = mapRef.current

    if (map === null) {
      return
    }

    const markers = vehicleMarkersRef.current
    const seen = new Set<string>()

    nodes.filter(isDrawable).forEach((node) => {
      const id = node.identity.id
      seen.add(id)

      const position = toLngLat(node.latDeg, node.lonDeg)
      let marker = markers.get(id)

      if (marker === undefined) {
        const element = createVehicleMarkerElement(colorOf(id))
        element.title = node.identity.label
        element.addEventListener('click', () => handlersRef.current.onSelectNode?.(id))

        marker = new maplibregl.Marker({ element }).setLngLat(position).addTo(map)
        markers.set(id, marker)
      } else {
        marker.setLngLat(position)
      }

      // Rotate with the map so the nose points at the true heading even when the
      // view is rotated away from north.
      marker.setRotationAlignment('map')
      marker.setRotation(node.headingDeg ?? 0)
      marker.getElement().style.opacity = String(freshnessOpacity(node.freshness))
    })

    // Drop markers for nodes that lost their fix or were swept as stale.
    markers.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    })
  }, [nodes, colorOf])

  // Fit once, as soon as there is anything to frame.
  useEffect(() => {
    if (hasFittedRef.current || fleetBounds(nodes) === null) {
      return
    }

    hasFittedRef.current = true
    fitFleet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes])

  // Route lines. Redrawn only when the overlay would actually differ, never on
  // an ordinary roster tick.
  useEffect(() => {
    const routes = routeFeatureCollection(overlayNodesRef.current, missions, colorOf)
    routesRef.current = routes

    const map = mapRef.current

    if (map !== null) {
      syncRoutesSource(map, routes)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, colorOf])

  /*
   * Waypoint badges: one DOM marker per waypoint per node, keyed by
   * `nodeId#seq`. Same keyed diff as the vehicle markers, and as MapPanel's
   * single-node version — `seq` alone is not unique across a fleet, since every
   * node's plan starts at 0.
   *
   * Keyed on the overlay signature, not the roster: badges sit on the ground and
   * must not be restyled every time a vehicle moves.
   */
  useEffect(() => {
    const map = mapRef.current

    if (map === null) {
      return
    }

    const markers = waypointMarkersRef.current
    const seen = new Set<string>()

    overlayNodesRef.current.forEach((node) => {
      const mission = missionFor(node, missions)

      if (mission === null) {
        return
      }

      const color = colorOf(node.identity.id)

      sortedWaypoints(mission).forEach((item) => {
        const key = waypointKey(node.identity.id, item.seq)
        seen.add(key)

        const active = isActiveMissionWaypoint(item.seq, mission.activeIndex)
        const position = toLngLat(item.latDeg, item.lonDeg)
        const existing = markers.get(key)

        if (existing === undefined) {
          const marker = new maplibregl.Marker({
            element: createWaypointMarkerElement(item.seq, active, color),
          })
            .setLngLat(position)
            .addTo(map)
          markers.set(key, marker)
          return
        }

        existing.setLngLat(position)
        styleWaypointMarker(existing.getElement(), active, color)
      })
    })

    // Drop badges for shorter reloads, cleared plans, and evicted nodes.
    markers.forEach((marker, key) => {
      if (!seen.has(key)) {
        marker.remove()
        markers.delete(key)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, colorOf])

  return <div ref={containerRef} className="map-panel" />
})
