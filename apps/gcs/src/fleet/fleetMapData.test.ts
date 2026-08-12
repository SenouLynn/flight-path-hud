import { EMPTY_MISSION, type MissionItem, type MissionPlan, type NodeSummary } from '@flight-path-hud/gcs-core'
import { describe, expect, it } from 'vitest'
import {
  fleetBounds,
  freshnessOpacity,
  isDrawable,
  missionFor,
  overlaySignature,
  routeFeatureCollection,
  sortedWaypoints,
} from './fleetMapData'

function node(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    identity: { id: 'mavlink:1:1', kind: 'mavlink-vehicle', label: '1:1' },
    latDeg: 47.397742,
    lonDeg: 8.545594,
    altMslM: 500,
    headingDeg: 90,
    groundSpeedMps: 18,
    lastUpdateMs: 1000,
    ageMs: 0,
    freshness: 'live',
    hasFix: true,
    ...overrides,
  }
}

function item(seq: number, latDeg: number, lonDeg: number): MissionItem {
  return { seq, command: 16, current: false, autocontinue: true, latDeg, lonDeg, altM: 50 }
}

function mission(items: MissionItem[]): MissionPlan {
  return { status: 'complete', items, activeIndex: null, reason: null }
}

const alwaysRed = () => '#ff0000'

describe('freshnessOpacity', () => {
  it('fades a node as its data ages', () => {
    expect(freshnessOpacity('live')).toBe(1)
    expect(freshnessOpacity('aging')).toBeLessThan(freshnessOpacity('live'))
    expect(freshnessOpacity('stale')).toBeLessThan(freshnessOpacity('aging'))
  })

  it('keeps a stale node visible, since its last position is still information', () => {
    expect(freshnessOpacity('stale')).toBeGreaterThan(0)
  })
})

describe('isDrawable', () => {
  it('accepts a node with a fix', () => {
    expect(isDrawable(node())).toBe(true)
  })

  it('rejects a node without a fix, which belongs in the roster but not on the map', () => {
    expect(isDrawable(node({ hasFix: false, latDeg: null, lonDeg: null }))).toBe(false)
  })

  it('rejects a node claiming a fix but carrying no position', () => {
    expect(isDrawable(node({ hasFix: true, latDeg: null }))).toBe(false)
  })
})

describe('missionFor', () => {
  it('crosses the node-id and systemKey formats', () => {
    const plan = mission([item(0, 47, 8)])
    // The map is keyed '2:1'; the node knows itself as 'mavlink:2:1'.
    const missions = new Map([['2:1', plan]])
    const summary = node({ identity: { id: 'mavlink:2:1', kind: 'mavlink-vehicle', label: '2:1' } })

    expect(missionFor(summary, missions)).toBe(plan)
  })

  it('is null when the node has no plan yet', () => {
    expect(missionFor(node(), new Map())).toBeNull()
  })

  it('is null for a node whose transport has no MAVLink system key', () => {
    const summary = node({
      identity: { id: 'meshtastic:abc', kind: 'mavlink-vehicle', label: 'abc' },
    })

    expect(missionFor(summary, new Map([['1:1', mission([item(0, 47, 8)])]]))).toBeNull()
  })

  it('does not hand one node another node\'s plan', () => {
    const missions = new Map([['1:1', mission([item(0, 47, 8)])]])
    const other = node({ identity: { id: 'mavlink:2:1', kind: 'mavlink-vehicle', label: '2:1' } })

    expect(missionFor(other, missions)).toBeNull()
  })
})

describe('sortedWaypoints', () => {
  it('orders by seq, since wire order is not flight order', () => {
    const plan = mission([item(2, 47.2, 8.2), item(0, 47.0, 8.0), item(1, 47.1, 8.1)])

    expect(sortedWaypoints(plan).map((waypoint) => waypoint.seq)).toEqual([0, 1, 2])
  })

  it('does not mutate the plan it was given', () => {
    const items = [item(2, 47.2, 8.2), item(0, 47.0, 8.0)]
    sortedWaypoints(mission(items))

    expect(items.map((waypoint) => waypoint.seq)).toEqual([2, 0])
  })
})

describe('routeFeatureCollection', () => {
  it('emits one feature per node that has a drawable route', () => {
    const nodes = [node()]
    const missions = new Map([['1:1', mission([item(0, 47.0, 8.0), item(1, 47.1, 8.1)])]])

    const collection = routeFeatureCollection(nodes, missions, alwaysRed)

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].geometry.coordinates).toEqual([[8.0, 47.0], [8.1, 47.1]])
  })

  it('writes lng,lat — the flip is the classic silent map bug', () => {
    const missions = new Map([['1:1', mission([item(0, 47.0, 8.0), item(1, 47.1, 8.1)])]])

    const [lng, lat] = routeFeatureCollection([node()], missions, alwaysRed)
      .features[0].geometry.coordinates[0]

    expect(lng).toBe(8.0)
    expect(lat).toBe(47.0)
  })

  it('carries each node\'s own colour, so two routes are told apart', () => {
    const nodes = [
      node(),
      node({ identity: { id: 'mavlink:2:1', kind: 'mavlink-vehicle', label: '2:1' } }),
    ]
    const plan = mission([item(0, 47.0, 8.0), item(1, 47.1, 8.1)])
    const missions = new Map([['1:1', plan], ['2:1', plan]])

    const collection = routeFeatureCollection(nodes, missions, (id) => `color-for-${id}`)

    expect(collection.features.map((feature) => feature.properties?.color)).toEqual([
      'color-for-mavlink:1:1',
      'color-for-mavlink:2:1',
    ])
  })

  it('sorts each route by seq', () => {
    const missions = new Map([
      ['1:1', mission([item(1, 47.1, 8.1), item(0, 47.0, 8.0)])],
    ])

    expect(routeFeatureCollection([node()], missions, alwaysRed).features[0].geometry.coordinates)
      .toEqual([[8.0, 47.0], [8.1, 47.1]])
  })

  it('skips nodes with no mission, an empty one, or a single waypoint', () => {
    const missions = new Map([['1:1', EMPTY_MISSION], ['2:1', mission([item(0, 47, 8)])]])
    const nodes = [
      node(),
      node({ identity: { id: 'mavlink:2:1', kind: 'mavlink-vehicle', label: '2:1' } }),
      node({ identity: { id: 'mavlink:3:1', kind: 'mavlink-vehicle', label: '3:1' } }),
    ]

    expect(routeFeatureCollection(nodes, missions, alwaysRed).features).toHaveLength(0)
  })

  it('draws a route for a node that has no fix, since the plan is still known', () => {
    // The vehicle is not on the map, but where it was told to go is not in doubt.
    const missions = new Map([['1:1', mission([item(0, 47.0, 8.0), item(1, 47.1, 8.1)])]])

    expect(routeFeatureCollection([node({ hasFix: false })], missions, alwaysRed).features)
      .toHaveLength(1)
  })
})

describe('overlaySignature', () => {
  const missions = new Map([['1:1', mission([item(0, 47.0, 8.0), item(1, 47.1, 8.1)])]])

  it('is unchanged when only the vehicles moved', () => {
    // The roster republishes every 500 ms whether or not anything changed. Routes
    // and waypoint badges are fixed to the ground, so a moving vehicle must not
    // cause the whole fleet's overlay to be rebuilt and re-pushed at 2 Hz.
    const before = overlaySignature([node({ latDeg: 47.0, lonDeg: 8.0 })], missions)
    const after = overlaySignature([node({ latDeg: 47.9, lonDeg: 8.9 })], missions)

    expect(after).toBe(before)
  })

  it('is unchanged when only freshness or age moved on', () => {
    const before = overlaySignature([node({ ageMs: 0, freshness: 'live' })], missions)
    const after = overlaySignature([node({ ageMs: 9000, freshness: 'aging' })], missions)

    expect(after).toBe(before)
  })

  it('changes when a node joins the fleet', () => {
    const before = overlaySignature([node()], missions)
    const after = overlaySignature(
      [node(), node({ identity: { id: 'mavlink:2:1', kind: 'mavlink-vehicle', label: '2:1' } })],
      missions,
    )

    expect(after).not.toBe(before)
  })

  it('changes when a node is hidden or swept away', () => {
    const both = [node(), node({ identity: { id: 'mavlink:2:1', kind: 'mavlink-vehicle', label: '2:1' } })]

    expect(overlaySignature([both[0]], missions)).not.toBe(overlaySignature(both, missions))
  })

  it('changes when a mission arrives', () => {
    const before = overlaySignature([node()], new Map())
    const after = overlaySignature([node()], missions)

    expect(after).not.toBe(before)
  })

  it('changes when a plan is reloaded with different waypoints', () => {
    const shorter = new Map([['1:1', mission([item(0, 47.0, 8.0)])]])

    expect(overlaySignature([node()], shorter)).not.toBe(overlaySignature([node()], missions))
  })

  it('changes when a waypoint moves, even with the same count', () => {
    const moved = new Map([['1:1', mission([item(0, 47.0, 8.0), item(1, 47.5, 8.5)])]])

    expect(overlaySignature([node()], moved)).not.toBe(overlaySignature([node()], missions))
  })

  it('changes when the active waypoint changes', () => {
    const plan = mission([item(0, 47.0, 8.0), item(1, 47.1, 8.1)])
    const active = new Map([['1:1', { ...plan, activeIndex: 1 }]])

    expect(overlaySignature([node()], active)).not.toBe(overlaySignature([node()], missions))
  })

  it('ignores a mission belonging to a node that is not on the map', () => {
    // A hidden node's plan is still in the feed; it must not keep the visible
    // fleet's overlay churning.
    const withStranger = new Map(missions).set('9:1', mission([item(0, 40, 5), item(1, 41, 6)]))

    expect(overlaySignature([node()], withStranger)).toBe(overlaySignature([node()], missions))
  })
})

describe('fleetBounds', () => {
  it('is null when nothing has a position', () => {
    expect(fleetBounds([])).toBeNull()
    expect(fleetBounds([node({ hasFix: false, latDeg: null, lonDeg: null })])).toBeNull()
  })

  it('is a zero-area box for a single node', () => {
    expect(fleetBounds([node({ latDeg: 47, lonDeg: 8 })])).toEqual([[8, 47], [8, 47]])
  })

  it('encloses every node, in [[west, south], [east, north]] order', () => {
    const bounds = fleetBounds([
      node({ latDeg: 47.0, lonDeg: 8.0 }),
      node({ latDeg: 47.5, lonDeg: 8.6 }),
      node({ latDeg: 46.8, lonDeg: 8.2 }),
    ])

    expect(bounds).toEqual([[8.0, 46.8], [8.6, 47.5]])
  })

  it('ignores nodes with no fix rather than folding a null into the box', () => {
    const bounds = fleetBounds([
      node({ latDeg: 47.0, lonDeg: 8.0 }),
      node({ hasFix: false, latDeg: null, lonDeg: null }),
    ])

    expect(bounds).toEqual([[8.0, 47.0], [8.0, 47.0]])
  })

  it('handles negative coordinates', () => {
    const bounds = fleetBounds([
      node({ latDeg: -33.9, lonDeg: -70.6 }),
      node({ latDeg: -34.2, lonDeg: -70.1 }),
    ])

    expect(bounds).toEqual([[-70.6, -34.2], [-70.1, -33.9]])
  })
})
