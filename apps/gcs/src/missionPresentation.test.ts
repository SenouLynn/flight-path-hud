import { describe, expect, it } from 'vitest'
import { displayedActiveMissionIndex, isActiveMissionWaypoint } from './missionPresentation'

describe('mission active presentation', () => {
  it('does not present ArduPilot mission-home item zero as actively navigated', () => {
    expect(isActiveMissionWaypoint(0, 0)).toBe(false)
    expect(displayedActiveMissionIndex(0)).toBeNull()
  })

  it('highlights a real current mission item by sequence number', () => {
    expect(isActiveMissionWaypoint(2, 2)).toBe(true)
    expect(isActiveMissionWaypoint(1, 2)).toBe(false)
    expect(displayedActiveMissionIndex(2)).toBe(2)
  })

  it('keeps absent current state absent', () => {
    expect(isActiveMissionWaypoint(1, null)).toBe(false)
    expect(displayedActiveMissionIndex(null)).toBeNull()
  })
})
