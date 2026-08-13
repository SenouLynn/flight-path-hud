import { describe, expect, it } from 'vitest'
import { displayedActiveMissionIndex, hasDrawableMissionPosition, isActiveMissionWaypoint } from './missionPresentation'

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

describe('mission position presentation', () => {
  const item = (latDeg: number, lonDeg: number) => ({
    seq: 1, command: 22, current: false, autocontinue: true, latDeg, lonDeg, altM: 35,
  })

  it('does not draw the 0,0 sentinel used by takeoff-at-current-position', () => {
    expect(hasDrawableMissionPosition(item(0, 0))).toBe(false)
  })

  it('retains real geographic mission positions', () => {
    expect(hasDrawableMissionPosition(item(-35.36, 149.16))).toBe(true)
  })
})
