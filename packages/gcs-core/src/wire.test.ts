import { describe, expect, it } from 'vitest'
import { parseWireEvent, parseWireFrame, parseWireMessage, encodeRequestMission, systemKey } from './wire'

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

describe('parseWireEvent', () => {
  // parseWireEvent's contract is "raw socket message in" — on a live WebSocket,
  // `event.data` is always a string, so every fixture below is JSON.stringify'd
  // before being handed in, exactly as stream.ts's onMessage will do it.

  it('passes through a valid telemetry frame with kind telemetry', () => {
    const event = parseWireEvent(JSON.stringify(validFrame()))

    if (event.kind !== 'telemetry') {
      throw new Error(`expected telemetry event, got ${event.kind}`)
    }
    expect(event.frame.sysId).toBe(1)
    expect(event.frame.messageName).toBe('GLOBAL_POSITION_INT')
  })

  it('parses a well-formed mission frame', () => {
    const missionFrame = {
      type: 'mission',
      sysId: 1,
      compId: 2,
      status: 'complete',
      items: [
        { seq: 0, command: 16, current: false, autocontinue: true, latDeg: 47.5, lonDeg: 8.5, altM: 100 },
      ],
      activeIndex: 0,
      reason: null,
    }

    const event = parseWireEvent(JSON.stringify(missionFrame))

    if (event.kind !== 'mission') {
      throw new Error(`expected mission event, got ${event.kind}`)
    }
    expect(event.frame.type).toBe('mission')
    expect(event.frame.sysId).toBe(1)
    expect(event.frame.compId).toBe(2)
    expect(event.frame.status).toBe('complete')
    expect(event.frame.items).toHaveLength(1)
    expect(event.frame.items[0].seq).toBe(0)
    expect(event.frame.activeIndex).toBe(0)
  })

  it('parses a well-formed home frame', () => {
    const homeFrame = {
      type: 'home',
      sysId: 1,
      compId: 2,
      lat: 47.5,
      lon: 8.5,
      altMslM: 100,
    }

    const event = parseWireEvent(JSON.stringify(homeFrame))

    if (event.kind !== 'home') {
      throw new Error(`expected home event, got ${event.kind}`)
    }
    expect(event.frame.type).toBe('home')
    expect(event.frame.lat).toBe(47.5)
    expect(event.frame.lon).toBe(8.5)
  })

  it('parses a well-formed linkMode frame', () => {
    const linkModeFrame = {
      type: 'linkMode',
      replayMode: true,
    }

    const event = parseWireEvent(JSON.stringify(linkModeFrame))

    if (event.kind !== 'linkMode') {
      throw new Error(`expected linkMode event, got ${event.kind}`)
    }
    expect(event.frame.type).toBe('linkMode')
    expect(event.frame.replayMode).toBe(true)
  })

  it('parses flight state and Guided reposition lifecycle frames', () => {
    const flight = parseWireEvent(JSON.stringify({ type: 'flightState', sysId: 2, compId: 1,
      armed: true, baseMode: 129, customMode: 15, systemStatus: 4, vehicleType: 1,
      autopilotType: 3, observedAtMs: 1000 }))
    expect(flight.kind).toBe('flightState')

    const guided = parseWireEvent(JSON.stringify({ type: 'guidedReposition', requestId: 'r1',
      sysId: 2, compId: 1, status: 'awaitingObservation', ackResult: 0, observed: false,
      attempts: 1, horizontalDistanceM: null, altitudeErrorM: null, reason: null,
      updatedAtMs: 1100 }))
    expect(guided.kind).toBe('guidedReposition')

    const common = { requestId: 'r2', sysId: 1, compId: 1, status: 'complete',
      ackResult: 0, observed: true, attempts: 1, reason: null, updatedAtMs: 1200 }
    expect(parseWireEvent(JSON.stringify({ type: 'modeChange', ...common, mode: 'GUIDED', customMode: 4 })).kind).toBe('modeChange')
    expect(parseWireEvent(JSON.stringify({ type: 'armDisarm', ...common, arm: true })).kind).toBe('armDisarm')
    expect(parseWireEvent(JSON.stringify({ type: 'guidedTakeoff', ...common, relativeAltitudeM: 10,
      altitudeToleranceM: 2, altitudeErrorM: 1 })).kind).toBe('guidedTakeoff')
    expect(parseWireEvent(JSON.stringify({ type: 'guidedLand', ...common,
      touchdownAltitudeM: 0.75, relativeAltitudeM: 0.5 })).kind).toBe('guidedLand')
  })

  it('rejects partial safety-state and Guided lifecycle frames', () => {
    expect(parseWireEvent(JSON.stringify({ type: 'flightState', sysId: 1, compId: 1,
      armed: true }))).toEqual({ kind: 'unrecognized' })
    expect(parseWireEvent(JSON.stringify({ type: 'guidedReposition', requestId: 'r1',
      sysId: 1, compId: 1, status: 'complete' }))).toEqual({ kind: 'unrecognized' })
    expect(parseWireEvent(JSON.stringify({ type: 'guidedTakeoff', requestId: 'r1',
      sysId: 1, compId: 1, status: 'complete' }))).toEqual({ kind: 'unrecognized' })
  })

  it('returns unrecognized for mission frame with bad status', () => {
    const missionFrame = {
      type: 'mission',
      sysId: 1,
      compId: 2,
      status: 'invalid_status',
      items: [],
      activeIndex: null,
      reason: null,
    }

    const event = parseWireEvent(JSON.stringify(missionFrame))

    expect(event.kind).toBe('unrecognized')
  })

  it('returns unrecognized for mission frame with non-array items', () => {
    const missionFrame = {
      type: 'mission',
      sysId: 1,
      compId: 2,
      status: 'complete',
      items: 'not an array',
      activeIndex: null,
      reason: null,
    }

    const event = parseWireEvent(JSON.stringify(missionFrame))

    expect(event.kind).toBe('unrecognized')
  })

  it('returns unrecognized for mission frame with malformed item', () => {
    const missionFrame = {
      type: 'mission',
      sysId: 1,
      compId: 2,
      status: 'complete',
      items: [
        { seq: 0, command: 16, current: false, autocontinue: true, latDeg: 47.5, lonDeg: 8.5 },
      ],
      activeIndex: null,
      reason: null,
    }

    const event = parseWireEvent(JSON.stringify(missionFrame))

    expect(event.kind).toBe('unrecognized')
  })

  it('returns unrecognized for untagged garbage with no type', () => {
    const event = parseWireEvent(JSON.stringify({ something: 'random' }))

    expect(event.kind).toBe('unrecognized')
  })

  it('returns unrecognized for non-string input', () => {
    // Guards against the exact regression this fix addresses: an already-parsed
    // object (or any other non-string) must never reach JSON.parse.
    expect(parseWireEvent(42).kind).toBe('unrecognized')
    expect(parseWireEvent(null).kind).toBe('unrecognized')
    expect(parseWireEvent(undefined).kind).toBe('unrecognized')
    expect(parseWireEvent(validFrame()).kind).toBe('unrecognized')
  })

  it('returns unrecognized for malformed JSON rather than throwing', () => {
    expect(parseWireEvent('{ not json').kind).toBe('unrecognized')
  })

  it('returns unrecognized for well-formed JSON that is not an object', () => {
    expect(parseWireEvent('42').kind).toBe('unrecognized')
    expect(parseWireEvent('null').kind).toBe('unrecognized')
    expect(parseWireEvent('"just a string"').kind).toBe('unrecognized')
  })
})

describe('encodeRequestMission', () => {
  it('encodes valid sysId and compId to JSON that round-trips correctly', () => {
    const encoded = encodeRequestMission(1, 2)

    expect(encoded).not.toBeNull()
    expect(typeof encoded).toBe('string')

    const parsed = JSON.parse(encoded!)
    expect(parsed.type).toBe('requestMission')
    expect(parsed.sysId).toBe(1)
    expect(parsed.compId).toBe(2)
  })

  it('returns null for sysId out of range', () => {
    expect(encodeRequestMission(-1, 1)).toBeNull()
    expect(encodeRequestMission(256, 1)).toBeNull()
  })

  it('returns null for compId out of range', () => {
    expect(encodeRequestMission(1, -1)).toBeNull()
    expect(encodeRequestMission(1, 256)).toBeNull()
  })

  it('returns null for non-integer sysId or compId', () => {
    expect(encodeRequestMission(1.5, 1)).toBeNull()
    expect(encodeRequestMission(1, 2.5)).toBeNull()
  })

  it('returns null for undefined sysId or compId', () => {
    expect(encodeRequestMission(undefined as any, 1)).toBeNull()
    expect(encodeRequestMission(1, undefined as any)).toBeNull()
  })

  it('encodes boundary values correctly', () => {
    const encoded0 = encodeRequestMission(0, 0)
    expect(encoded0).not.toBeNull()
    expect(JSON.parse(encoded0!)).toEqual({ type: 'requestMission', sysId: 0, compId: 0 })

    const encoded255 = encodeRequestMission(255, 255)
    expect(encoded255).not.toBeNull()
    expect(JSON.parse(encoded255!)).toEqual({ type: 'requestMission', sysId: 255, compId: 255 })
  })
})

describe('systemKey', () => {
  it('identifies a vehicle by system and component', () => {
    expect(systemKey(1, 1)).toBe('1:1')
    expect(systemKey(2, 1)).not.toBe(systemKey(1, 1))
  })
})
