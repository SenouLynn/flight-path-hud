import { describe, expect, it } from 'vitest'
import { HEADING_FALLBACK_AFTER_MS, hasFix, mergeVehicleState } from './vehicle'
import type { WireFrame } from './wire'

function frame(messageName: string, payload: Partial<WireFrame['payload']>, recvTimestampMs = 1000): WireFrame {
  return {
    recvTimestampMs,
    sysId: 1,
    compId: 1,
    messageName,
    sequence: 1,
    payload: { timestampMs: recvTimestampMs, ...payload },
  }
}

const POSITION = frame('GLOBAL_POSITION_INT', {
  globalPositionInt: {
    latDegE7: 473977420,
    lonDegE7: 85455940,
    altMm: 500000,
    relativeAltMm: 12000,
    headingCdeg: 18000,
  },
})

describe('mergeVehicleState', () => {
  it('converts a position frame into degrees and metres', () => {
    const state = mergeVehicleState(null, POSITION)

    expect(state.latDeg).toBeCloseTo(47.397742, 8)
    expect(state.lonDeg).toBeCloseTo(8.545594, 8)
    expect(state.altMslM).toBeCloseTo(500, 6)
    expect(state.altRelM).toBeCloseTo(12, 6)
  })

  it('keeps the last known fix when a later frame carries no position', () => {
    // The regression that broke the GPS track before: the bridge emits an explicit
    // undefined for every field a message did not populate.
    const withFix = mergeVehicleState(null, POSITION)
    const afterHeartbeat = mergeVehicleState(withFix, frame('HEARTBEAT', {}))

    expect(afterHeartbeat.latDeg).toBeCloseTo(47.397742, 8)
    expect(afterHeartbeat.lonDeg).toBeCloseTo(8.545594, 8)
    expect(afterHeartbeat.altMslM).toBeCloseTo(500, 6)
  })

  it('keeps the last fix when a position frame omits only some fields', () => {
    const withFix = mergeVehicleState(null, POSITION)
    const partial = mergeVehicleState(withFix, frame('GLOBAL_POSITION_INT', {
      globalPositionInt: { altMm: 501000 },
    }))

    expect(partial.altMslM).toBeCloseTo(501, 6)
    expect(partial.latDeg).toBeCloseTo(47.397742, 8)
  })

  it('prefers VFR_HUD heading over the GLOBAL_POSITION_INT fallback', () => {
    const state = mergeVehicleState(null, frame('VFR_HUD', {
      globalPositionInt: { headingCdeg: 18000 },
      vfrHud: { headingDeg: 90 },
    }))

    expect(state.headingDeg).toBe(90)
    expect(state.headingSource).toBe('VFR_HUD.heading')
  })

  it('falls back to GLOBAL_POSITION_INT.hdg when VFR_HUD has no heading', () => {
    const state = mergeVehicleState(null, POSITION)

    expect(state.headingDeg).toBeCloseTo(180, 6)
    expect(state.headingSource).toBe('GLOBAL_POSITION_INT.hdg')
  })

  it('treats the 65535 sentinel as no heading rather than 655 degrees', () => {
    const state = mergeVehicleState(null, frame('GLOBAL_POSITION_INT', {
      globalPositionInt: { latDegE7: 1, lonDegE7: 2, headingCdeg: 65535 },
    }))

    expect(state.headingDeg).toBeNull()
    expect(state.headingSource).toBe('none')
  })

  it('does not flap between heading sources on an interleaved stream', () => {
    // The bridge sends one message per frame, so VFR_HUD and GLOBAL_POSITION_INT
    // alternate. Taking whichever arrived last would jitter the heading between
    // two slightly different sources — the same fault that made the ground track
    // flip between vx/vy and cog.
    let state = mergeVehicleState(null, frame('VFR_HUD', { vfrHud: { headingDeg: 90 } }, 1000))
    const sources = new Set<string>()

    for (let index = 1; index <= 20; index += 1) {
      const timestampMs = 1000 + index * 30
      state = index % 2 === 0
        ? mergeVehicleState(state, frame('VFR_HUD', { vfrHud: { headingDeg: 90 } }, timestampMs))
        : mergeVehicleState(state, frame('GLOBAL_POSITION_INT', {
          globalPositionInt: { latDegE7: 1, lonDegE7: 2, headingCdeg: 9100 },
        }, timestampMs))
      sources.add(state.headingSource)
    }

    expect([...sources]).toEqual(['VFR_HUD.heading'])
    expect(state.headingDeg).toBe(90)
  })

  it('falls back to GLOBAL_POSITION_INT once VFR_HUD goes quiet', () => {
    const withVfr = mergeVehicleState(null, frame('VFR_HUD', { vfrHud: { headingDeg: 90 } }, 1000))
    const muchLater = mergeVehicleState(withVfr, frame('GLOBAL_POSITION_INT', {
      globalPositionInt: { latDegE7: 1, lonDegE7: 2, headingCdeg: 27000 },
    }, 1000 + HEADING_FALLBACK_AFTER_MS + 1))

    expect(muchLater.headingSource).toBe('GLOBAL_POSITION_INT.hdg')
    expect(muchLater.headingDeg).toBeCloseTo(270, 6)
  })

  it('holds the previous heading when a frame carries none at all', () => {
    const withHeading = mergeVehicleState(null, frame('VFR_HUD', { vfrHud: { headingDeg: 42 } }))
    const afterHeartbeat = mergeVehicleState(withHeading, frame('HEARTBEAT', {}))

    expect(afterHeartbeat.headingDeg).toBe(42)
    expect(afterHeartbeat.headingSource).toBe('VFR_HUD.heading')
  })

  it('accumulates a full sample across frames for the HUD instruments', () => {
    // The map only needs lat/lon, but the instruments render from the same fold,
    // so attitude arriving in one frame must survive the next.
    let state = mergeVehicleState(null, frame('ATTITUDE', {
      attitude: { rollRad: 0.4, pitchRad: 0.1, yawRad: 3.1, pitchSpeedRadPerSec: 0.05, yawSpeedRadPerSec: 0.2 },
    }, 1000))
    state = mergeVehicleState(state, frame('VFR_HUD', {
      vfrHud: { headingDeg: 180, airSpeedMps: 18, groundSpeedMps: 17, climbMps: 1 },
    }, 1030))
    state = mergeVehicleState(state, POSITION)

    expect(state.sample.attitude?.rollRad).toBeCloseTo(0.4, 8)
    expect(state.sample.attitude?.yawSpeedRadPerSec).toBeCloseTo(0.2, 8)
    expect(state.sample.vfrHud?.airSpeedMps).toBe(18)
    expect(state.sample.globalPositionInt?.latDegE7).toBe(473977420)
    expect(state.sample.timestampMs).toBe(POSITION.payload.timestampMs)
  })

  it('advances lastUpdateMs on every frame', () => {
    const first = mergeVehicleState(null, frame('HEARTBEAT', {}, 1000))
    const second = mergeVehicleState(first, frame('HEARTBEAT', {}, 1150))

    expect(second.lastUpdateMs).toBe(1150)
  })

  it('does not mutate the previous state', () => {
    const withFix = mergeVehicleState(null, POSITION)
    const snapshot = { ...withFix }
    mergeVehicleState(withFix, frame('VFR_HUD', { vfrHud: { headingDeg: 5 } }))

    expect(withFix).toEqual(snapshot)
  })
})

describe('hasFix', () => {
  it('is false until both coordinates are known', () => {
    expect(hasFix(null)).toBe(false)
    expect(hasFix(mergeVehicleState(null, frame('HEARTBEAT', {})))).toBe(false)
    expect(hasFix(mergeVehicleState(null, POSITION))).toBe(true)
  })
})
