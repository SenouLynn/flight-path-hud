import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTelemetryStream, type ConnectionState, type SocketLike } from './stream'
import type { WireFrame } from './wire'

type Listener = (event: unknown) => void

class FakeSocket implements SocketLike {
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

  listenerCount(event: 'open' | 'close' | 'error' | 'message'): number {
    return this.listeners[event].size
  }
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    data: JSON.stringify({
      recvTimestampMs: 1000,
      sysId: 1,
      compId: 1,
      messageName: 'GLOBAL_POSITION_INT',
      sequence: 3,
      payload: { timestampMs: 999, globalPositionInt: { latDegE7: 473977420, lonDegE7: 85455940 } },
      ...overrides,
    }),
  }
}

describe('startTelemetryStream', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers parsed frames', () => {
    const socket = new FakeSocket()
    const frames: WireFrame[] = []
    const stop = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: (frame) => frames.push(frame) },
    )

    socket.emit('open')
    socket.emit('message', message())

    expect(frames).toHaveLength(1)
    expect(frames[0].payload.globalPositionInt?.latDegE7).toBe(473977420)

    stop()
  })

  it('reports connection state transitions', () => {
    const socket = new FakeSocket()
    const states: ConnectionState[] = []
    const stop = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: () => undefined, onConnectionState: (state) => states.push(state) },
    )

    expect(states).toContain('connecting')
    socket.emit('open')
    expect(states.at(-1)).toBe('open')
    socket.emit('error')
    expect(states.at(-1)).toBe('error')

    stop()
    expect(states.at(-1)).toBe('closed')
  })

  it('counts malformed frames instead of throwing', () => {
    const socket = new FakeSocket()
    let decodeErrors = 0
    const frames: WireFrame[] = []
    const stop = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: (frame) => frames.push(frame), onDecodeError: () => { decodeErrors += 1 } },
    )

    socket.emit('open')
    socket.emit('message', { data: '{ not json' })
    socket.emit('message', { data: JSON.stringify({ sysId: 1 }) })
    socket.emit('message', message())

    expect(decodeErrors).toBe(2)
    expect(frames).toHaveLength(1)

    stop()
  })

  it('reconnects with capped exponential backoff after a close', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const stop = startTelemetryStream(
      {
        url: 'ws://test',
        socketFactory: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        reconnectInitialMs: 100,
        reconnectMaxMs: 400,
        reconnectMultiplier: 2,
      },
      { onFrame: () => undefined },
    )

    expect(sockets).toHaveLength(1)

    sockets[0].emit('close')
    vi.advanceTimersByTime(100)
    expect(sockets).toHaveLength(2)

    sockets[1].emit('close')
    vi.advanceTimersByTime(199)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    // Backoff is capped, so the delay stops growing past reconnectMaxMs.
    sockets[2].emit('close')
    vi.advanceTimersByTime(400)
    expect(sockets).toHaveLength(4)

    stop()
  })

  it('resets the backoff once a connection opens', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const stop = startTelemetryStream(
      {
        url: 'ws://test',
        socketFactory: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        reconnectInitialMs: 100,
        reconnectMultiplier: 2,
      },
      { onFrame: () => undefined },
    )

    sockets[0].emit('close')
    vi.advanceTimersByTime(100)
    sockets[1].emit('open')
    sockets[1].emit('close')

    // Back to the initial delay rather than the grown one.
    vi.advanceTimersByTime(100)
    expect(sockets).toHaveLength(3)

    stop()
  })

  it('stops cleanly: no reconnect, listeners detached, socket closed', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const stop = startTelemetryStream(
      {
        url: 'ws://test',
        socketFactory: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        reconnectInitialMs: 100,
      },
      { onFrame: () => undefined },
    )

    stop()

    expect(sockets[0].closeCallCount).toBe(1)
    expect(sockets[0].listenerCount('message')).toBe(0)

    sockets[0].emit('close')
    vi.advanceTimersByTime(5000)
    expect(sockets).toHaveLength(1)
  })
})
