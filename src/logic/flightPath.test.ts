import { describe, expect, it } from 'vitest'
import {
  cmsToMps,
  mpsToKnots,
  resolveFlightPath2d,
  resolveFlightPath3d,
  resolvePredictivePath,
  resolveScalarTelemetry,
} from './flightPath'
import { FLIGHT_PATH_VALIDATION_FRAMES, runFlightPathReplay } from './replay'

describe('flightPath utilities', () => {
  it('converts cm/s to m/s and m/s to knots', () => {
    expect(cmsToMps(1234)).toBeCloseTo(12.34, 8)
    expect(mpsToKnots(10)).toBeCloseTo(19.43844, 8)
  })
})

describe('resolveScalarTelemetry', () => {
  it('prefers VFR_HUD scalars over derived values', () => {
    const resolved = resolveScalarTelemetry({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 18,
        climbMps: 3,
      },
      globalPositionInt: {
        vxCms: 1000,
        vyCms: 0,
        vzCms: 200,
      },
    })

    expect(resolved.groundSpeedMps).toBeCloseTo(18, 8)
    expect(resolved.climbMps).toBeCloseTo(3, 8)
    expect(resolved.speedSource).toBe('VFR_HUD.groundspeed')
    expect(resolved.climbSource).toBe('VFR_HUD.climb')
  })

  it('resolves airspeed from VFR_HUD.airspeed independently of groundspeed', () => {
    const resolved = resolveScalarTelemetry({
      timestampMs: 0,
      vfrHud: {
        airSpeedMps: 20,
        groundSpeedMps: 16,
      },
    })

    expect(resolved.airSpeedMps).toBeCloseTo(20, 8)
    expect(resolved.airSpeedKnots).toBeCloseTo(38.87688, 5)
    expect(resolved.airSpeedSource).toBe('VFR_HUD.airspeed')
    // Groundspeed is a separate channel and must be unaffected.
    expect(resolved.groundSpeedMps).toBeCloseTo(16, 8)
    expect(resolved.speedSource).toBe('VFR_HUD.groundspeed')
  })

  it('reports airspeed as null when VFR_HUD.airspeed is absent', () => {
    const resolved = resolveScalarTelemetry({
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 16,
      },
    })

    expect(resolved.airSpeedMps).toBeNull()
    expect(resolved.airSpeedKnots).toBeNull()
    expect(resolved.airSpeedSource).toBe('none')
  })

  it('falls back to GLOBAL_POSITION_INT and GPS_RAW_INT when VFR missing', () => {
    const globalResolved = resolveScalarTelemetry({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 300,
        vyCms: 400,
        vzCms: -120,
      },
    })

    expect(globalResolved.groundSpeedMps).toBeCloseTo(5, 8)
    expect(globalResolved.climbMps).toBeCloseTo(1.2, 8)
    expect(globalResolved.speedSource).toBe('GLOBAL_POSITION_INT.vx_vy')
    expect(globalResolved.climbSource).toBe('GLOBAL_POSITION_INT.vz')

    const gpsResolved = resolveScalarTelemetry({
      timestampMs: 0,
      gpsRawInt: {
        velCms: 1234,
      },
    })

    expect(gpsResolved.groundSpeedMps).toBeCloseTo(12.34, 8)
    expect(gpsResolved.speedSource).toBe('GPS_RAW_INT.vel')
  })
})

describe('resolveFlightPath2d', () => {
  it('derives track and speed from GLOBAL_POSITION_INT vx/vy', () => {
    const resolved = resolveFlightPath2d({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 1000,
        vyCms: 1000,
      },
    })

    expect(resolved.isValid).toBe(true)
    expect(resolved.source).toBe('GLOBAL_POSITION_INT.vx_vy')
    expect(resolved.trackDeg).toBeCloseTo(45, 8)
    expect(resolved.speedMps).toBeCloseTo(14.1421356, 6)
  })

  it('uses GPS fallback and handles stationary velocity', () => {
    const gpsResolved = resolveFlightPath2d({
      timestampMs: 0,
      gpsRawInt: {
        cogCdeg: 18000,
        velCms: 900,
      },
    })

    expect(gpsResolved.isValid).toBe(true)
    expect(gpsResolved.source).toBe('GPS_RAW_INT.cog_vel')
    expect(gpsResolved.trackDeg).toBeCloseTo(180, 8)

    const stationaryResolved = resolveFlightPath2d({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 0,
        vyCms: 0,
      },
    })

    expect(stationaryResolved.isValid).toBe(false)
    expect(stationaryResolved.trackDeg).toBeNull()
    expect(stationaryResolved.speedMps).toBe(0)
  })
})

describe('resolveFlightPath3d', () => {
  it('derives FPA from GLOBAL_POSITION_INT vx/vy/vz', () => {
    const resolved = resolveFlightPath3d({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 1000,
        vyCms: 0,
        vzCms: -100,
      },
    })

    expect(resolved.isValid).toBe(true)
    expect(resolved.source).toBe('GLOBAL_POSITION_INT.vx_vy_vz')
    expect(resolved.trackDeg).toBeCloseTo(0, 8)
    expect(resolved.speedMps).toBeCloseTo(10, 8)
    expect(resolved.verticalSpeedMps).toBeCloseTo(1, 8)
    expect(resolved.flightPathAngleDeg).toBeCloseTo(5.710593, 6)
  })

  it('returns invalid when required 3d fields are missing', () => {
    const resolved = resolveFlightPath3d({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 1000,
      },
    })

    expect(resolved.isValid).toBe(false)
    expect(resolved.source).toBe('none')
    expect(resolved.flightPathAngleDeg).toBeNull()
  })
})

describe('resolvePredictivePath', () => {
  it('builds linear and turn-aware paths over a 5 second horizon', () => {
    const resolved = resolvePredictivePath({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 1000,
        vyCms: 0,
      },
      attitude: {
        yawSpeedRadPerSec: 0.2,
      },
    })

    expect(resolved.isValid).toBe(true)
    expect(resolved.source).toBe('GLOBAL_POSITION_INT+ATTITUDE.yawspeed')
    expect(resolved.linear).toHaveLength(11)
    expect(resolved.turnAware).toHaveLength(11)

    const linearEnd = resolved.linear.at(-1)
    const turnEnd = resolved.turnAware.at(-1)
    expect(linearEnd?.northM).toBeCloseTo(50, 6)
    expect(linearEnd?.eastM).toBeCloseTo(0, 6)
    expect(turnEnd?.northM).toBeCloseTo(42.073549, 6)
    expect(turnEnd?.eastM).toBeCloseTo(22.984885, 6)
  })

  it('falls back to linear projection when yaw rate is missing', () => {
    const resolved = resolvePredictivePath({
      timestampMs: 0,
      globalPositionInt: {
        vxCms: 1000,
        vyCms: 1000,
      },
    })

    expect(resolved.isValid).toBe(true)
    expect(resolved.source).toBe('GLOBAL_POSITION_INT.linear')

    const linearEnd = resolved.linear.at(-1)
    const turnEnd = resolved.turnAware.at(-1)
    expect(linearEnd?.northM).toBeCloseTo(turnEnd?.northM ?? 0, 8)
    expect(linearEnd?.eastM).toBeCloseTo(turnEnd?.eastM ?? 0, 8)
  })
})

describe('runFlightPathReplay', () => {
  it('matches expected scalar and track values for replay fixtures', () => {
    const replay = runFlightPathReplay(FLIGHT_PATH_VALIDATION_FRAMES)

    expect(replay).toHaveLength(FLIGHT_PATH_VALIDATION_FRAMES.length)

    for (const row of replay) {
      if (row.expectedTrackDeg === null) {
        expect(row.vector2d.trackDeg).toBeNull()
      } else {
        expect(row.vector2d.trackDeg).not.toBeNull()
        expect(row.trackErrorDeg).toBeLessThan(0.0001)
      }

      if (row.expectedSpeedMps !== null) {
        expect(row.speedErrorMps).toBeLessThan(0.0001)
      }

      if (row.expectedClimbMps !== null) {
        expect(row.climbErrorMps).toBeLessThan(0.0001)
      }

      if (row.expectedFpaDeg !== null) {
        expect(row.fpaErrorDeg).toBeLessThan(0.0001)
      }

      if (row.expectedLinearEndNorthM !== null) {
        expect(row.linearEndErrorM).toBeLessThan(0.0001)
      }

      if (row.expectedTurnEndNorthM !== null) {
        expect(row.turnEndErrorM).toBeLessThan(0.0001)
      }
    }
  })
})
