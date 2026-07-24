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

describe('resolvePredictiveTrajectory — turn/climb kinematics', () => {
  const G = 9.81

  it('recovers the coordinated turn rate from body rates without double-counting', () => {
    const V = 24
    const phi = Math.PI / 6 // 30° bank
    const theta = Math.PI / 36 // 5° pitch
    const coordinated = (G * Math.tan(phi)) / V
    // Steady coordinated-turn body rates for this bank/pitch.
    const q = coordinated * Math.sin(phi) * Math.cos(theta)
    const r = coordinated * Math.cos(phi) * Math.cos(theta)

    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: { airSpeedMps: V, groundSpeedMps: V, climbMps: 0 },
      attitude: { rollRad: phi, pitchRad: theta, pitchSpeedRadPerSec: q, yawSpeedRadPerSec: r },
    })

    // The Euler transform recovers the true turn rate — not the ~2× a naive
    // (yawRate + g·tanφ/V) sum would produce.
    expect(trajectory.turnRateRadPerSec).toBeCloseTo(coordinated, 2)
    expect(trajectory.coordinatedTurnRateRadPerSec).toBeCloseTo(coordinated, 2)
    expect(trajectory.turnRateRadPerSec).toBeLessThan(coordinated * 1.5)
  })

  it('keeps the flight path level in a coordinated nose-up turn', () => {
    const V = 24
    const phi = Math.PI / 6 // 30° bank
    const theta = Math.PI / 12 // 15° nose-up
    const coordinated = (G * Math.tan(phi)) / V
    const q = coordinated * Math.sin(phi) * Math.cos(theta)
    const r = coordinated * Math.cos(phi) * Math.cos(theta)

    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: { airSpeedMps: V, groundSpeedMps: V, climbMps: 0 }, // FPA 0 → level
      attitude: { rollRad: phi, pitchRad: theta, pitchSpeedRadPerSec: q, yawSpeedRadPerSec: r },
    })

    // Nose-up and turning, yet the predicted path neither climbs nor descends.
    expect(trajectory.flightPathAngleDeg).toBeCloseTo(0, 5)
    expect(Math.abs(trajectory.forwardPoints.at(-1)?.verticalM ?? 99)).toBeLessThan(0.5)
    expect(Math.abs(trajectory.turnRateRadPerSec)).toBeGreaterThan(0.1)
  })

  it('derives climb from flight-path angle (vertical speed), not pitch attitude', () => {
    const V = 24
    const fpaRad = Math.PI / 36 // true climb angle 5°
    const climb = V * Math.sin(fpaRad)

    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: { airSpeedMps: V, groundSpeedMps: V, climbMps: climb },
      // Nose held 20° up (high AoA), but only climbing 5°.
      attitude: { rollRad: 0, pitchRad: Math.PI / 9, pitchSpeedRadPerSec: 0, yawSpeedRadPerSec: 0 },
    })

    expect(trajectory.flightPathAngleDeg).toBeCloseTo(5, 1)
    expect(trajectory.verticalRateMps).toBeCloseTo(climb, 2)
    // The path climbs at the FPA, far shallower than the 20° pitch would imply.
    expect(trajectory.forwardPoints.at(-1)?.verticalM ?? 0).toBeGreaterThan(0)
  })

  it('falls back to the coordinated-turn rate when no body rates are present', () => {
    const V = 24
    const phi = Math.PI / 9 // 20° bank
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: { airSpeedMps: V, groundSpeedMps: V, climbMps: 0 },
      attitude: { rollRad: phi, pitchRad: 0 }, // no rate fields at all
    })

    const coordinated = (G * Math.tan(phi)) / V
    expect(trajectory.turnRateRadPerSec).toBeCloseTo(coordinated, 3)
    expect(trajectory.coordinatedTurnRateRadPerSec).toBeCloseTo(coordinated, 3)
    expect(trajectory.climbAngleRateRadPerSec).toBe(0)
  })

  it('does not turn from bank alone when body rates report no rotation (slip)', () => {
    const phi = Math.PI / 6 // 30° bank held, zero rotation
    const trajectory = resolvePredictiveTrajectory({
      timestampMs: 0,
      vfrHud: { airSpeedMps: 24, groundSpeedMps: 24, climbMps: 0 },
      attitude: { rollRad: phi, pitchRad: 0, pitchSpeedRadPerSec: 0, yawSpeedRadPerSec: 0 },
    })

    // Rates are trusted over bank: no rotation → no turn, even though the bank
    // implies a coordinated turn would exist.
    expect(trajectory.turnRateRadPerSec).toBeCloseTo(0, 5)
    expect(Math.abs(trajectory.coordinatedTurnRateRadPerSec)).toBeGreaterThan(0.1)
  })
})
