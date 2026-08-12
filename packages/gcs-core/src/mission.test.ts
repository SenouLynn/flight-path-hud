import { describe, expect, it } from 'vitest'
import { EMPTY_MISSION, missionPlanFromFrame } from './mission'
import type { MissionWireFrame } from './wire'

describe('missionPlanFromFrame', () => {
  it('maps a pending frame with no items', () => {
    const frame: MissionWireFrame = {
      type: 'mission',
      sysId: 1,
      compId: 1,
      status: 'pending',
      items: [],
      activeIndex: null,
      reason: null,
    }

    const result = missionPlanFromFrame(frame)

    expect(result.status).toBe('pending')
    expect(result.items).toEqual([])
    expect(result.activeIndex).toBeNull()
    expect(result.reason).toBeNull()
  })

  it('maps a complete frame with items', () => {
    const frame: MissionWireFrame = {
      type: 'mission',
      sysId: 1,
      compId: 1,
      status: 'complete',
      items: [
        {
          seq: 0,
          command: 16,
          current: false,
          autocontinue: true,
          latDeg: 47.6,
          lonDeg: -122.3,
          altM: 100,
        },
        {
          seq: 1,
          command: 16,
          current: true,
          autocontinue: true,
          latDeg: 47.7,
          lonDeg: -122.2,
          altM: 150,
        },
      ],
      activeIndex: 1,
      reason: null,
    }

    const result = missionPlanFromFrame(frame)

    expect(result.status).toBe('complete')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual({
      seq: 0,
      command: 16,
      current: false,
      autocontinue: true,
      latDeg: 47.6,
      lonDeg: -122.3,
      altM: 100,
    })
    expect(result.items[1]).toEqual({
      seq: 1,
      command: 16,
      current: true,
      autocontinue: true,
      latDeg: 47.7,
      lonDeg: -122.2,
      altM: 150,
    })
    expect(result.activeIndex).toBe(1)
    expect(result.reason).toBeNull()
  })

  it('maps a failed frame with a reason', () => {
    const frame: MissionWireFrame = {
      type: 'mission',
      sysId: 1,
      compId: 1,
      status: 'failed',
      items: [],
      activeIndex: null,
      reason: 'Communication lost',
    }

    const result = missionPlanFromFrame(frame)

    expect(result.status).toBe('failed')
    expect(result.items).toEqual([])
    expect(result.activeIndex).toBeNull()
    expect(result.reason).toBe('Communication lost')
  })

  it('maps all 7 item fields correctly', () => {
    const frame: MissionWireFrame = {
      type: 'mission',
      sysId: 2,
      compId: 5,
      status: 'pending',
      items: [
        {
          seq: 42,
          command: 22,
          current: false,
          autocontinue: false,
          latDeg: 51.5074,
          lonDeg: -0.1278,
          altM: 250,
        },
      ],
      activeIndex: null,
      reason: null,
    }

    const result = missionPlanFromFrame(frame)
    const item = result.items[0]

    expect(item.seq).toBe(42)
    expect(item.command).toBe(22)
    expect(item.current).toBe(false)
    expect(item.autocontinue).toBe(false)
    expect(item.latDeg).toBe(51.5074)
    expect(item.lonDeg).toBe(-0.1278)
    expect(item.altM).toBe(250)
  })

  it('distinguishes zero waypoints with complete status from EMPTY_MISSION (idle)', () => {
    const completeFrame: MissionWireFrame = {
      type: 'mission',
      sysId: 1,
      compId: 1,
      status: 'complete',
      items: [],
      activeIndex: null,
      reason: null,
    }

    const result = missionPlanFromFrame(completeFrame)

    // Both have empty items[], but EMPTY_MISSION has status:'idle' while result has status:'complete'
    // They must be deep-unequal
    expect(result).not.toEqual(EMPTY_MISSION)
    expect(result.status).toBe('complete')
    expect(EMPTY_MISSION.status).toBe('idle')
  })
})
