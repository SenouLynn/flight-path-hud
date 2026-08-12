import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NODE_FRESHNESS_CONFIG,
  classifyFreshness,
  mavlinkNodeIdentity,
  nodeSummaryFromVehicle,
  summarizeNodes,
} from './nodes'
import type { VehicleState } from './vehicle'

function vehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysId: 1,
    compId: 1,
    latDeg: 47.397742,
    lonDeg: 8.545594,
    altMslM: 500,
    altRelM: 12,
    headingDeg: 180,
    headingSource: 'VFR_HUD.heading',
    headingUpdatedMs: 1000,
    groundSpeedMps: 18,
    lastUpdateMs: 1000,
    sample: { timestampMs: 1000 },
    ...overrides,
  }
}

describe('mavlinkNodeIdentity', () => {
  it('builds a transport-scoped id so other transports cannot collide with it', () => {
    expect(mavlinkNodeIdentity(1, 1)).toEqual({
      id: 'mavlink:1:1',
      kind: 'mavlink-vehicle',
      label: '1:1',
    })
  })

  it('defaults its label to the string the system selector already shows', () => {
    expect(mavlinkNodeIdentity(2, 190).label).toBe('2:190')
  })

  it('accepts an explicit label without changing the id', () => {
    const identity = mavlinkNodeIdentity(2, 1, 'Figure-8 01')
    expect(identity.label).toBe('Figure-8 01')
    expect(identity.id).toBe('mavlink:2:1')
  })

  it('is stable across calls, so it can key a map', () => {
    expect(mavlinkNodeIdentity(3, 1).id).toBe(mavlinkNodeIdentity(3, 1).id)
  })

  it('distinguishes components of the same system', () => {
    expect(mavlinkNodeIdentity(1, 1).id).not.toBe(mavlinkNodeIdentity(1, 2).id)
  })
})

describe('classifyFreshness', () => {
  it('classifies each band', () => {
    expect(classifyFreshness(0)).toBe('live')
    expect(classifyFreshness(2999)).toBe('live')
    expect(classifyFreshness(5000)).toBe('aging')
    expect(classifyFreshness(60000)).toBe('stale')
  })

  it('treats the thresholds as inclusive lower bounds', () => {
    // Stated explicitly because "at exactly 3 s" is the case a caller will hit.
    expect(classifyFreshness(DEFAULT_NODE_FRESHNESS_CONFIG.agingAfterMs)).toBe('aging')
    expect(classifyFreshness(DEFAULT_NODE_FRESHNESS_CONFIG.agingAfterMs - 1)).toBe('live')
    expect(classifyFreshness(DEFAULT_NODE_FRESHNESS_CONFIG.staleAfterMs)).toBe('stale')
    expect(classifyFreshness(DEFAULT_NODE_FRESHNESS_CONFIG.staleAfterMs - 1)).toBe('aging')
  })

  it('reads a reporter whose clock runs ahead as live, not stale', () => {
    // Clamping matters: a negative age must not fall through to the stale branch.
    expect(classifyFreshness(-5000)).toBe('live')
  })

  it('honours a custom config', () => {
    // A mesh transport beaconing every few minutes needs far looser bands than
    // a vehicle streaming at 33 Hz — which is the whole reason this is a config.
    const mesh = { agingAfterMs: 120000, staleAfterMs: 600000 }
    expect(classifyFreshness(60000, mesh)).toBe('live')
    expect(classifyFreshness(300000, mesh)).toBe('aging')
    expect(classifyFreshness(900000, mesh)).toBe('stale')
  })

  it('keeps both default thresholds inside the feed eviction TTL', () => {
    // Freshness is a display concept, not eviction: a node must be visibly
    // degraded for a good while before it is dropped from the roster entirely.
    expect(DEFAULT_NODE_FRESHNESS_CONFIG.agingAfterMs).toBeLessThan(DEFAULT_NODE_FRESHNESS_CONFIG.staleAfterMs)
    expect(DEFAULT_NODE_FRESHNESS_CONFIG.staleAfterMs).toBeLessThan(60000)
  })
})

describe('nodeSummaryFromVehicle', () => {
  it('projects position, course and identity', () => {
    const summary = nodeSummaryFromVehicle(vehicle(), 1500)

    expect(summary.identity.id).toBe('mavlink:1:1')
    expect(summary.latDeg).toBeCloseTo(47.397742, 8)
    expect(summary.headingDeg).toBe(180)
    expect(summary.groundSpeedMps).toBe(18)
    expect(summary.lastUpdateMs).toBe(1000)
    expect(summary.ageMs).toBe(500)
    expect(summary.freshness).toBe('live')
    expect(summary.hasFix).toBe(true)
  })

  it('ages a node that has gone quiet, with no new frames needed', () => {
    // The property that forces the consumer to recompute on a timer rather than
    // per frame: a node going silent is precisely when no frames arrive.
    const quiet = vehicle()
    expect(nodeSummaryFromVehicle(quiet, 1000).freshness).toBe('live')
    expect(nodeSummaryFromVehicle(quiet, 6000).freshness).toBe('aging')
    expect(nodeSummaryFromVehicle(quiet, 30000).freshness).toBe('stale')
  })

  it('never reports a negative age', () => {
    expect(nodeSummaryFromVehicle(vehicle(), 0).ageMs).toBe(0)
  })

  it('reports a node with no fix rather than omitting it', () => {
    // A node heard from but not yet located still belongs on the roster; it just
    // has nothing to draw on the map.
    const summary = nodeSummaryFromVehicle(vehicle({ latDeg: null, lonDeg: null }), 1000)

    expect(summary.hasFix).toBe(false)
    expect(summary.latDeg).toBeNull()
    expect(summary.identity.id).toBe('mavlink:1:1')
  })

  it('treats a half-populated position as no fix', () => {
    expect(nodeSummaryFromVehicle(vehicle({ lonDeg: null }), 1000).hasFix).toBe(false)
  })

  it('passes through a missing heading without inventing one', () => {
    const summary = nodeSummaryFromVehicle(vehicle({ headingDeg: null, groundSpeedMps: null }), 1000)
    expect(summary.headingDeg).toBeNull()
    expect(summary.groundSpeedMps).toBeNull()
  })
})

describe('summarizeNodes', () => {
  it('summarizes every vehicle it is given', () => {
    const summaries = summarizeNodes([vehicle(), vehicle({ sysId: 2 })], 1000)
    expect(summaries.map((summary) => summary.identity.id)).toEqual(['mavlink:1:1', 'mavlink:2:1'])
  })

  it('orders by id regardless of which node reported last', () => {
    // A roster that reshuffled at telemetry rate would be unusable.
    const ordered = summarizeNodes([vehicle({ sysId: 2 }), vehicle({ sysId: 1 })], 1000)
    const reversed = summarizeNodes([vehicle({ sysId: 1 }), vehicle({ sysId: 2 })], 1000)
    expect(ordered.map((s) => s.identity.id)).toEqual(reversed.map((s) => s.identity.id))
  })

  it('sorts ids numerically, not lexically', () => {
    // Plain string sort puts sysId 10 ahead of sysId 2.
    const summaries = summarizeNodes(
      [vehicle({ sysId: 10 }), vehicle({ sysId: 2 }), vehicle({ sysId: 1 })],
      1000,
    )

    expect(summaries.map((summary) => summary.identity.id))
      .toEqual(['mavlink:1:1', 'mavlink:2:1', 'mavlink:10:1'])
  })

  it('orders components within a system', () => {
    const summaries = summarizeNodes([vehicle({ compId: 10 }), vehicle({ compId: 2 })], 1000)
    expect(summaries.map((summary) => summary.identity.id)).toEqual(['mavlink:1:2', 'mavlink:1:10'])
  })

  it('accepts a Map iterator, which is how the feed holds its vehicles', () => {
    const vehicles = new Map([['1:1', vehicle()], ['2:1', vehicle({ sysId: 2 })]])
    expect(summarizeNodes(vehicles.values(), 1000)).toHaveLength(2)
  })

  it('returns an empty roster before anything has been heard', () => {
    expect(summarizeNodes([], 1000)).toEqual([])
  })

  it('gives each node its own freshness', () => {
    // The mixed case the fleet view exists to show: one node live, one gone quiet.
    const summaries = summarizeNodes(
      [vehicle({ sysId: 1, lastUpdateMs: 30000 }), vehicle({ sysId: 2, lastUpdateMs: 1000 })],
      30000,
    )

    expect(summaries.map((summary) => summary.freshness)).toEqual(['live', 'stale'])
  })
})
