import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetrySample } from '@flight-path-hud/hud-ui'
import type { StreamHealthSnapshot } from './streamPorts'
import { createWsTelemetrySource, type WebSocketLike } from './wsTelemetrySource'

type Listener = (event: unknown) => void

class FakeSocket implements WebSocketLike {
  private listeners: Record<'open' | 'close' | 'error' | 'message', Set<Listener>> = {
    open: new Set(),
    close: new Set(),
    error: new Set(),
    message: new Set(),
  }

  public closeCallCount = 0

  addEventListener(event: 'open' | 'close' | 'error' | 'message', handler: Listener): void {
    this.listeners[event].add(handler)
  }

  removeEventListener(event: 'open' | 'close' | 'error' | 'message', handler: Listener): void {
    this.listeners[event].delete(handler)
  }

  close(): void {
    this.closeCallCount += 1
  }

  emit(event: 'open' | 'close' | 'error' | 'message', payload?: unknown): void {
    this.listeners[event].forEach((listener) => {
      listener(payload)
    })
  }
}

describe('createWsTelemetrySource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('parses valid envelopes and emits telemetry samples', () => {
    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
    })

    const seenSamples: TelemetrySample[] = []
    const seenHealth: StreamHealthSnapshot[] = []

    const stop = source.start(
      (sample) => {
        seenSamples.push(sample)
      },
      (snapshot) => {
        seenHealth.push(snapshot)
      },
    )

    socket.emit('open')
    socket.emit('message', {
      data: JSON.stringify({
        recvTimestampMs: 1000,
        sysId: 1,
        compId: 1,
        messageName: 'ATTITUDE',
        sequence: 10,
        payload: {
          timestampMs: 999,
          attitude: {
            pitchRad: 0.12,
          },
        },
      }),
    })

    expect(seenSamples).toHaveLength(1)
    expect(seenSamples[0].attitude?.pitchRad).toBeCloseTo(0.12, 8)
    expect(seenHealth.at(-1)?.connectionState).toBe('open')

    stop()
    expect(socket.closeCallCount).toBe(1)
  })

  it('merges partial telemetry messages into one coherent sample', () => {
    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
    })

    const seenSamples: TelemetrySample[] = []

    const stop = source.start((sample) => {
      seenSamples.push(sample)
    })

    socket.emit('open')
    socket.emit('message', {
      data: JSON.stringify({
        recvTimestampMs: 1000,
        sysId: 1,
        compId: 1,
        messageName: 'ATTITUDE',
        sequence: 10,
        payload: {
          timestampMs: 999,
          attitude: {
            pitchRad: 0.12,
          },
        },
      }),
    })
    socket.emit('message', {
      data: JSON.stringify({
        recvTimestampMs: 1001,
        sysId: 1,
        compId: 1,
        messageName: 'VFR_HUD',
        sequence: 11,
        payload: {
          timestampMs: 1000,
          vfrHud: {
            headingDeg: 182,
          },
        },
      }),
    })

    expect(seenSamples).toHaveLength(2)
    expect(seenSamples.at(-1)?.attitude?.pitchRad).toBeCloseTo(0.12, 8)
    expect(seenSamples.at(-1)?.vfrHud?.headingDeg).toBe(182)

    stop()
  })

  it('keeps samples from different systems separate when unfiltered', () => {
    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
    })

    const seenSamples: TelemetrySample[] = []

    const stop = source.start((sample) => {
      seenSamples.push(sample)
    })

    const buildMessage = (sysId: number, messageName: string, payload: object) => ({
      data: JSON.stringify({
        recvTimestampMs: 1000,
        sysId,
        compId: 1,
        messageName,
        sequence: 10,
        payload: { timestampMs: 999, ...payload },
      }),
    })

    socket.emit('open')
    socket.emit('message', buildMessage(1, 'ATTITUDE', { attitude: { pitchRad: 0.12 } }))
    socket.emit('message', buildMessage(2, 'VFR_HUD', { vfrHud: { headingDeg: 182 } }))

    // System 2 must not inherit system 1's attitude.
    expect(seenSamples.at(-1)?.vfrHud?.headingDeg).toBe(182)
    expect(seenSamples.at(-1)?.attitude?.pitchRad).toBeUndefined()

    stop()
  })

  it('does not let a later partial message erase known-good fields', () => {
    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
    })

    const seenSamples: TelemetrySample[] = []
    const stop = source.start((sample) => {
      seenSamples.push(sample)
    })

    const send = (globalPositionInt: object) => socket.emit('message', {
      data: JSON.stringify({
        recvTimestampMs: 1000,
        sysId: 1,
        compId: 1,
        messageName: 'GLOBAL_POSITION_INT',
        sequence: 10,
        payload: { timestampMs: 999, globalPositionInt },
      }),
    })

    socket.emit('open')
    send({ latDegE7: 473977420, lonDegE7: 85455940, vxCms: 100, vyCms: 200 })
    // A later frame carrying only velocity must not drop the last known fix.
    send({ vxCms: 150, vyCms: 250 })

    expect(seenSamples.at(-1)?.globalPositionInt?.vxCms).toBe(150)
    expect(seenSamples.at(-1)?.globalPositionInt?.latDegE7).toBe(473977420)
    expect(seenSamples.at(-1)?.globalPositionInt?.lonDegE7).toBe(85455940)

    stop()
  })

  it('reports packet rate per tick rather than a running count', () => {
    vi.useFakeTimers()

    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
      healthTickMs: 1000,
    })

    const seenHealth: StreamHealthSnapshot[] = []

    const stop = source.start(
      () => undefined,
      (snapshot) => {
        seenHealth.push(snapshot)
      },
    )

    const message = {
      data: JSON.stringify({
        recvTimestampMs: 1000,
        sysId: 1,
        compId: 1,
        messageName: 'ATTITUDE',
        sequence: 10,
        payload: { timestampMs: 999, attitude: { pitchRad: 0.12 } },
      }),
    }

    socket.emit('open')
    socket.emit('message', message)
    socket.emit('message', message)
    socket.emit('message', message)

    // Mid-tick emissions must not report the partial in-flight count as a rate.
    expect(seenHealth.at(-1)?.packetRateHz).toBe(0)

    vi.advanceTimersByTime(1000)
    expect(seenHealth.at(-1)?.packetRateHz).toBe(3)

    vi.advanceTimersByTime(1000)
    expect(seenHealth.at(-1)?.packetRateHz).toBe(0)

    stop()
  })

  it('tracks decode errors for malformed messages', () => {
    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
      healthTickMs: 100,
    })

    const seenHealth: StreamHealthSnapshot[] = []

    const stop = source.start(
      () => undefined,
      (snapshot) => {
        seenHealth.push(snapshot)
      },
    )

    socket.emit('open')
    socket.emit('message', { data: '{bad json' })

    expect(seenHealth.at(-1)?.decodeErrorCount).toBeGreaterThanOrEqual(1)
    expect(seenHealth.at(-1)?.droppedPacketCount).toBeGreaterThanOrEqual(1)

    stop()
  })

  it('tracks systems and message rates from health metadata and filters non-selected systems', () => {
    const socket = new FakeSocket()
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => socket,
      getSystemFilter: () => ({ sysId: 2, compId: 1 }),
    })

    const seenSamples: TelemetrySample[] = []
    const seenHealth: StreamHealthSnapshot[] = []

    const stop = source.start(
      (sample) => {
        seenSamples.push(sample)
      },
      (snapshot) => {
        seenHealth.push(snapshot)
      },
    )

    socket.emit('open')
    socket.emit('message', {
      data: JSON.stringify({
        recvTimestampMs: 1000,
        sysId: 1,
        compId: 1,
        messageName: 'ATTITUDE',
        sequence: 10,
        payload: {
          timestampMs: 999,
          attitude: {
            pitchRad: 0.12,
          },
        },
        health: {
          activeSysId: 1,
          activeCompId: 1,
          messageRates: [{ messageName: 'ATTITUDE', rateHz: 10 }],
          systems: [{ sysId: 1, compId: 1, lastSeenTimestampMs: 1000 }],
        },
      }),
    })
    socket.emit('message', {
      data: JSON.stringify({
        recvTimestampMs: 1001,
        sysId: 2,
        compId: 1,
        messageName: 'VFR_HUD',
        sequence: 11,
        payload: {
          timestampMs: 1000,
          vfrHud: {
            headingDeg: 182,
          },
        },
        health: {
          activeSysId: 2,
          activeCompId: 1,
          messageRates: [{ messageName: 'VFR_HUD', rateHz: 8 }],
          systems: [
            { sysId: 1, compId: 1, lastSeenTimestampMs: 1000 },
            { sysId: 2, compId: 1, lastSeenTimestampMs: 1001 },
          ],
        },
      }),
    })

    expect(seenSamples).toHaveLength(1)
    expect(seenSamples[0].vfrHud?.headingDeg).toBe(182)
    expect(seenHealth.at(-1)?.systems).toHaveLength(2)
    expect(seenHealth.at(-1)?.messageRates[0]?.messageName).toBe('VFR_HUD')

    stop()
  })

  it('reconnects with backoff after close', () => {
    vi.useFakeTimers()

    const createdSockets: FakeSocket[] = []
    const source = createWsTelemetrySource({
      url: 'ws://test',
      socketFactory: () => {
        const socket = new FakeSocket()
        createdSockets.push(socket)
        return socket
      },
      reconnectInitialMs: 100,
      reconnectMaxMs: 1000,
      reconnectMultiplier: 2,
      healthTickMs: 1000,
    })

    const stop = source.start(() => undefined)

    expect(createdSockets).toHaveLength(1)
    createdSockets[0].emit('close')

    vi.advanceTimersByTime(99)
    expect(createdSockets).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(createdSockets).toHaveLength(2)

    stop()
  })
})
