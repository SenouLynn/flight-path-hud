import { describe, expect, it } from 'vitest'
import { parseWireFrame, parseWireMessage, systemKey } from './wire'

function validFrame() {
  return {
    recvTimestampMs: 1000,
    sysId: 1,
    compId: 1,
    messageName: 'GLOBAL_POSITION_INT',
    sequence: 7,
    payload: {
      timestampMs: 999,
      globalPositionInt: { latDegE7: 473977420, lonDegE7: 85455940, headingCdeg: 18000 },
    },
  }
}

describe('parseWireFrame', () => {
  it('accepts a well-formed frame and keeps the modelled fields', () => {
    const frame = parseWireFrame(validFrame())

    expect(frame?.sysId).toBe(1)
    expect(frame?.messageName).toBe('GLOBAL_POSITION_INT')
    expect(frame?.payload.globalPositionInt?.latDegE7).toBe(473977420)
    expect(frame?.payload.globalPositionInt?.headingCdeg).toBe(18000)
  })

  it('rebuilds rather than aliasing, so unknown envelope keys are dropped', () => {
    const input = validFrame() as Record<string, unknown>
    input.somethingElse = 'ignored'

    const frame = parseWireFrame(input)

    expect(frame).not.toBeNull()
    expect(frame as unknown as Record<string, unknown>).not.toHaveProperty('somethingElse')
  })

  it('keeps the full telemetry sample, not just the fields a map needs', () => {
    // The HUD instruments render from this same payload, so attitude and the
    // rate channels have to survive parsing.
    const frame = parseWireFrame({
      ...validFrame(),
      payload: {
        timestampMs: 999,
        attitude: { rollRad: 0.5, pitchRad: -0.2, yawRad: 1.1, pitchSpeedRadPerSec: 0.01, yawSpeedRadPerSec: 0.02 },
        vfrHud: { headingDeg: 90, airSpeedMps: 18, groundSpeedMps: 17, climbMps: 1.2 },
        gpsRawInt: { cogCdeg: 9000, velCms: 1700 },
      },
    })

    expect(frame?.payload.attitude?.rollRad).toBeCloseTo(0.5, 8)
    expect(frame?.payload.attitude?.yawSpeedRadPerSec).toBeCloseTo(0.02, 8)
    expect(frame?.payload.vfrHud?.climbMps).toBeCloseTo(1.2, 8)
    expect(frame?.payload.gpsRawInt?.velCms).toBe(1700)
  })

  it('rejects frames whose identity fields are out of uint8 range', () => {
    // The bridge wraps sequence at 256 precisely because consumers validate it here.
    expect(parseWireFrame({ ...validFrame(), sequence: 300 })).toBeNull()
    expect(parseWireFrame({ ...validFrame(), sysId: 256 })).toBeNull()
    expect(parseWireFrame({ ...validFrame(), compId: -1 })).toBeNull()
  })

  it('rejects frames with no usable payload timestamp', () => {
    expect(parseWireFrame({ ...validFrame(), payload: {} })).toBeNull()
    expect(parseWireFrame({ ...validFrame(), payload: { timestampMs: Number.NaN } })).toBeNull()
  })

  it('rejects a missing or empty message name', () => {
    expect(parseWireFrame({ ...validFrame(), messageName: '' })).toBeNull()
    expect(parseWireFrame({ ...validFrame(), messageName: '   ' })).toBeNull()
  })

  it('drops non-finite numerics inside a section instead of rejecting the frame', () => {
    const frame = parseWireFrame({
      ...validFrame(),
      payload: { timestampMs: 1, globalPositionInt: { latDegE7: Number.NaN, lonDegE7: 5 } },
    })

    expect(frame?.payload.globalPositionInt?.latDegE7).toBeUndefined()
    expect(frame?.payload.globalPositionInt?.lonDegE7).toBe(5)
  })

  it('rejects non-objects', () => {
    expect(parseWireFrame(null)).toBeNull()
    expect(parseWireFrame('frame')).toBeNull()
    expect(parseWireFrame(42)).toBeNull()
  })
})

describe('parseWireMessage', () => {
  it('parses a JSON string payload', () => {
    expect(parseWireMessage(JSON.stringify(validFrame()))?.sysId).toBe(1)
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseWireMessage('{ not json')).toBeNull()
  })

  it('returns null for non-string socket data', () => {
    expect(parseWireMessage(new ArrayBuffer(8))).toBeNull()
  })
})

describe('systemKey', () => {
  it('identifies a vehicle by system and component', () => {
    expect(systemKey(1, 1)).toBe('1:1')
    expect(systemKey(2, 1)).not.toBe(systemKey(1, 1))
  })
})
