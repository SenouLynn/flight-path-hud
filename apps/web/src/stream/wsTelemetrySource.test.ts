import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetrySample } from '../logic/telemetry'
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
