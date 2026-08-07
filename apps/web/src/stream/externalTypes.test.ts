import { describe, expect, it } from 'vitest'
import {
    isExternalTelemetryEnvelope,
    parseExternalTelemetryEnvelope,
    type ExternalTelemetryEnvelope,
} from './externalTypes'

function buildValidEnvelope(): ExternalTelemetryEnvelope {
  return {
    recvTimestampMs: 1000,
    sysId: 1,
    compId: 1,
    messageName: 'ATTITUDE',
    sequence: 42,
    payload: {
      timestampMs: 999,
      attitude: {
        rollRad: 0.2,
      },
    },
    health: {
      connectionState: 'open',
      packetRateHz: 50,
      decodeErrorCount: 0,
      droppedPacketCount: 0,
      lastHeartbeatAgeMs: 120,
    },
  }
}

describe('isExternalTelemetryEnvelope', () => {
  it('accepts a valid envelope', () => {
    const value = buildValidEnvelope()
    expect(isExternalTelemetryEnvelope(value)).toBe(true)
  })

  it('rejects missing required fields', () => {
    const value = {
      recvTimestampMs: 1000,
      sysId: 1,
      messageName: 'ATTITUDE',
      sequence: 42,
      payload: { timestampMs: 999 },
    }

    expect(isExternalTelemetryEnvelope(value)).toBe(false)
  })

  it('rejects out-of-range mavlink ids and sequence values', () => {
    const invalidSysId = {
      ...buildValidEnvelope(),
      sysId: 300,
    }

    const invalidCompId = {
      ...buildValidEnvelope(),
      compId: -1,
    }

    const invalidSequence = {
      ...buildValidEnvelope(),
      sequence: 256,
    }

    expect(isExternalTelemetryEnvelope(invalidSysId)).toBe(false)
    expect(isExternalTelemetryEnvelope(invalidCompId)).toBe(false)
    expect(isExternalTelemetryEnvelope(invalidSequence)).toBe(false)
  })

  it('rejects malformed health metadata', () => {
    const malformedState = {
      ...buildValidEnvelope(),
      health: {
        connectionState: 'ready',
      },
    }

    const malformedDecodeCounter = {
      ...buildValidEnvelope(),
      health: {
        decodeErrorCount: -2,
      },
    }

    expect(isExternalTelemetryEnvelope(malformedState)).toBe(false)
    expect(isExternalTelemetryEnvelope(malformedDecodeCounter)).toBe(false)
  })
})

describe('parseExternalTelemetryEnvelope', () => {
  it('sanitizes payload telemetry values', () => {
    const parsed = parseExternalTelemetryEnvelope({
      ...buildValidEnvelope(),
      payload: {
        timestampMs: 500,
        vfrHud: {
          headingDeg: Number.NaN,
          airSpeedMps: 21,
        },
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.payload.vfrHud?.headingDeg).toBeUndefined()
    expect(parsed?.payload.vfrHud?.airSpeedMps).toBe(21)
  })

  it('returns null for malformed input', () => {
    const parsed = parseExternalTelemetryEnvelope({
      recvTimestampMs: 1,
      sysId: 1,
      compId: 1,
      messageName: '',
      sequence: 1,
      payload: { timestampMs: 0 },
    })

    expect(parsed).toBeNull()
  })
})
