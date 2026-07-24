import { describe, expect, it } from 'vitest'
import { resolvePredictiveTrajectory } from './trajectory'

describe('resolvePredictiveTrajectory', () => {
  it('marks sub-stall speed as stalled and keeps the curve near center', () => {
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 11,
        climbMps: 0,
      },
      attitude: {
        pitchRad: 0,
        rollRad: 0,
      },
    })

    expect(trajectory.isStalled).toBe(true)
    expect(trajectory.points).toHaveLength(21)
    expect(Math.abs(trajectory.points.at(-1)?.x ?? 0)).toBeLessThan(5)
  })

  it('keys the stall flag and forward reach off airspeed, not groundspeed', () => {
    // Airspeed is below the 14 m/s stall default while groundspeed is well above
    // it (e.g. a strong tailwind). Stall must trigger on the airspeed.
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        airSpeedMps: 11,
        groundSpeedMps: 30,
        climbMps: 0,
      },
      attitude: {
        pitchRad: 0,
        rollRad: 0,
      },
    })

    expect(trajectory.airSpeedMps).toBeCloseTo(11, 8)
    expect(trajectory.isStalled).toBe(true)
    // Below stall → effectiveForwardSpeed is zero, so the corridor never advances.
    expect(Math.abs(trajectory.points.at(-1)?.y ?? 0)).toBeLessThan(0.0001)
  })

  it('stays unstalled when airspeed is above stall even if groundspeed is below', () => {
    // Headwind case: low groundspeed but healthy airspeed keeps the wing flying.
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        airSpeedMps: 20,
        groundSpeedMps: 8,
        climbMps: 0,
      },
      attitude: {
        pitchRad: 0,
        rollRad: 0,
      },
    })

    expect(trajectory.isStalled).toBe(false)
    expect(trajectory.points.at(-1)?.y ?? 0).toBeGreaterThan(0)
  })

  it('falls back to groundspeed for air-relative physics when airspeed is absent', () => {
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 24,
        climbMps: 0,
      },
      attitude: {
        pitchRad: 0,
        rollRad: 0,
      },
    })

    // No airspeed channel → the resolver treats groundspeed as the air-relative speed.
    expect(trajectory.airSpeedMps).toBeCloseTo(24, 8)
    expect(trajectory.isStalled).toBe(false)
  })

  it('curves and climbs when pitch, bank, and yaw rate are present', () => {
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 24,
        climbMps: 2,
      },
      attitude: {
        pitchRad: Math.PI / 18,
        rollRad: Math.PI / 10,
        yawSpeedRadPerSec: 0.22,
      },
    })

    const endpoint = trajectory.points.at(-1)

    expect(trajectory.isStalled).toBe(false)
    expect(trajectory.turnRateRadPerSec).not.toBe(0)
    expect(trajectory.verticalRateMps).toBeGreaterThan(0)
    expect(endpoint?.x ?? 0).not.toBe(0)
    expect(endpoint?.y ?? 0).toBeGreaterThan(0)
  })

  it('biases the curve laterally when heading and track differ', () => {
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 22,
        climbMps: 0.5,
      },
      attitude: {
        pitchRad: 0,
        rollRad: 0,
        yawRad: Math.PI / 3,
        yawSpeedRadPerSec: 0,
      },
      globalPositionInt: {
        vxCms: 2200,
        vyCms: 0,
      },
    })

    const endpoint = trajectory.points.at(-1)

    expect(trajectory.driftDeg).not.toBe(0)
    expect(trajectory.headingTrackDeltaDeg).toBeLessThan(0)
    expect(Math.abs(endpoint?.x ?? 0)).toBeGreaterThan(0)
  })

  it('emits a nose-relative forward path that advances in depth and lifts when climbing', () => {
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 24,
        climbMps: 3,
      },
      attitude: {
        pitchRad: Math.PI / 18,
        rollRad: Math.PI / 12,
      },
    })

    const forward = trajectory.forwardPoints
    expect(forward).toHaveLength(trajectory.points.length)
    expect(forward[0]).toEqual({ forwardM: 0, lateralM: 0, verticalM: 0, tSec: 0 })

    // Depth increases monotonically over the early corridor (before any sharp turn-back).
    expect(forward[1].forwardM).toBeGreaterThan(0)
    expect(forward.at(-1)?.forwardM ?? 0).toBeGreaterThan(forward[1].forwardM)

    // Positive climb → positive (upward) vertical offset; right bank → +right lateral.
    expect(forward.at(-1)?.verticalM ?? 0).toBeGreaterThan(0)
    expect(forward.at(-1)?.lateralM ?? 0).toBeGreaterThan(0)
  })
})
