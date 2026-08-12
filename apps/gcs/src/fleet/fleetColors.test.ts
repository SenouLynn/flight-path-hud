import { describe, expect, it } from 'vitest'
import { NODE_COLORS, nodeColor } from './fleetColors'

describe('nodeColor', () => {
  it('gives the same node the same colour every time', () => {
    expect(nodeColor('mavlink:1:1')).toBe(nodeColor('mavlink:1:1'))
  })

  it('only ever returns a colour from the palette', () => {
    for (let sysId = 0; sysId < 256; sysId += 1) {
      expect(NODE_COLORS).toContain(nodeColor(`mavlink:${sysId}:1`))
    }
  })

  it('separates the two nodes the mock fleet actually produces', () => {
    // The case an operator sees on every run, so it is worth pinning rather
    // than trusting the hash to have been kind.
    expect(nodeColor('mavlink:1:1')).not.toBe(nodeColor('mavlink:2:1'))
  })

  it('does not depend on roster position, so an eviction cannot recolour the fleet', () => {
    const before = ['mavlink:1:1', 'mavlink:2:1', 'mavlink:3:1'].map(nodeColor)
    // Node 1 goes quiet and is swept; the survivors must keep their colours.
    const after = ['mavlink:2:1', 'mavlink:3:1'].map(nodeColor)

    expect(after).toEqual(before.slice(1))
  })

  it('reaches every colour in the palette across a plausible fleet', () => {
    const seen = new Set<string>()

    for (let sysId = 0; sysId < 256; sysId += 1) {
      seen.add(nodeColor(`mavlink:${sysId}:1`))
    }

    expect(seen.size).toBe(NODE_COLORS.length)
  })

  it('keeps the active-waypoint highlight out of the palette', () => {
    // An identity colour that matched the "this waypoint is active" colour would
    // make a node's ordinary badges read as active.
    expect(NODE_COLORS).not.toContain('#ffdd57')
  })
})
