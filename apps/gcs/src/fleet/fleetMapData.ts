/**
 * Pure projections from the node roster onto what the fleet map draws.
 *
 * Kept out of FleetMap.tsx so the interesting decisions — which nodes are
 * drawable, what order a route's points go in, where the camera should sit — are
 * testable without a WebGL context. FleetMap is then only the imperative shell
 * that pushes these results at MapLibre.
 */

import { systemKeyFromNodeId, type MissionPlan, type NodeFreshness, type NodeSummary } from '@flight-path-hud/gcs-core'
import type { Feature, FeatureCollection, LineString } from 'geojson'

/**
 * How much to trust what is drawn, expressed as how solid it looks.
 *
 * Already this codebase's idiom: the single-node map dims a vehicle whose
 * heading it doesn't know to 0.45. A stale node stays visible — its last known
 * position is still information — but must not read as a live one.
 */
export function freshnessOpacity(freshness: NodeFreshness): number {
  switch (freshness) {
    case 'live':
      return 1
    case 'aging':
      return 0.6
    case 'stale':
      return 0.3
  }
}

/** A node the map can actually put a marker on. */
export function isDrawable(node: NodeSummary): node is NodeSummary & { latDeg: number; lonDeg: number } {
  return node.hasFix && node.latDeg !== null && node.lonDeg !== null
}

/**
 * Every node's route as one FeatureCollection, each feature carrying its own
 * colour.
 *
 * One source and one layer for the whole fleet, rather than a source per node:
 * `addSource` throws on a duplicate id, so per-node sources would need creating
 * and destroying as the roster changes, and every one of them would have to be
 * re-added after each basemap swap (`setStyle` tears down the entire style). A
 * single layer with `'line-color': ['get', 'color']` moves that per-node
 * branching into the GPU and leaves one thing to re-seed.
 *
 * A route needs two points to be a line, so single-waypoint and missing plans
 * are skipped — they still get waypoint badges, which are markers, not lines.
 */
export function routeFeatureCollection(
  nodes: readonly NodeSummary[],
  missions: ReadonlyMap<string, MissionPlan>,
  colorOf: (nodeId: string) => string,
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []

  for (const node of nodes) {
    const mission = missionFor(node, missions)

    if (mission === null || mission.items.length < 2) {
      continue
    }

    features.push({
      type: 'Feature',
      properties: { color: colorOf(node.identity.id), nodeId: node.identity.id },
      geometry: {
        type: 'LineString',
        coordinates: sortedWaypoints(mission).map((item) => [item.lonDeg, item.latDeg]),
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

/**
 * The plan belonging to a node, or null when it has none.
 *
 * The lookup crosses the two id formats: the roster speaks `NodeIdentity.id`
 * (`mavlink:1:1`), the mission map is keyed by `systemKey` (`1:1`). A node whose
 * id has no system key — any future non-MAVLink transport — has no MAVLink
 * mission by definition.
 */
export function missionFor(
  node: NodeSummary,
  missions: ReadonlyMap<string, MissionPlan>,
): MissionPlan | null {
  const key = systemKeyFromNodeId(node.identity.id)

  return key === null ? null : missions.get(key) ?? null
}

/**
 * Waypoints in flight order. Wire order is not guaranteed to match it, and
 * `seq` is also what `activeIndex` refers to — the same reason the single-node
 * map sorts before building its route line.
 */
export function sortedWaypoints(mission: MissionPlan): MissionPlan['items'] {
  return [...mission.items].sort((left, right) => left.seq - right.seq)
}

/** `[[west, south], [east, north]]`, MapLibre's fitBounds argument order. */
export type FleetBounds = [[number, number], [number, number]]

/**
 * The box enclosing every node that has a position, or null when none does.
 *
 * A single node yields a zero-area box; `fitBounds` handles that as long as the
 * caller passes a `maxZoom`, or it would zoom to the tile ceiling. Fleets
 * spanning the antimeridian are not handled — the box would wrap the long way
 * round. Accepted: it needs a split-bounds representation to fix properly, and
 * nothing in range of this project flies there.
 */
export function fleetBounds(nodes: readonly NodeSummary[]): FleetBounds | null {
  const drawable = nodes.filter(isDrawable)

  if (drawable.length === 0) {
    return null
  }

  const lats = drawable.map((node) => node.latDeg)
  const lons = drawable.map((node) => node.lonDeg)

  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}
