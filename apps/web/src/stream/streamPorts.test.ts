import { describe, expect, it } from 'vitest'
import type { ExternalTelemetryEnvelope } from './externalTypes'
import { createInMemoryGcsStreamPort } from './streamPorts'

function buildEnvelope(sequence: number): ExternalTelemetryEnvelope {
  return {
    recvTimestampMs: 1000 + sequence,
    sysId: 1,
    compId: 1,
    messageName: 'VFR_HUD',
    sequence,
    payload: {
      timestampMs: 1000 + sequence,
      vfrHud: {
        headingDeg: 90 + sequence,
      },
    },
  }
}

describe('createInMemoryGcsStreamPort', () => {
  it('broadcasts published envelopes to all subscribers', () => {
    const stream = createInMemoryGcsStreamPort()

    const seenA: number[] = []
    const seenB: number[] = []

    stream.subscribe((envelope) => {
      seenA.push(envelope.sequence)
    })

    stream.subscribe((envelope) => {
      seenB.push(envelope.sequence)
    })

    stream.publish(buildEnvelope(1))
    stream.publish(buildEnvelope(2))

    expect(seenA).toEqual([1, 2])
    expect(seenB).toEqual([1, 2])
  })

  it('stops delivering to unsubscribed listeners', () => {
    const stream = createInMemoryGcsStreamPort()

    const seen: number[] = []

    const stop = stream.subscribe((envelope) => {
      seen.push(envelope.sequence)
    })

    stream.publish(buildEnvelope(1))
    stop()
    stream.publish(buildEnvelope(2))

    expect(seen).toEqual([1])
  })
})
