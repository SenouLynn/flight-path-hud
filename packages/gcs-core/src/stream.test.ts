import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTelemetryStream, type ConnectionState, type SocketLike } from './stream'
import type { HomeWireFrame, LinkModeWireFrame, MissionWireFrame, WireFrame } from './wire'

type Listener = (event: unknown) => void

class FakeSocket implements SocketLike {
  private listeners: Record<'open' | 'close' | 'error' | 'message', Set<Listener>> = {
    open: new Set(),
    close: new Set(),
    error: new Set(),
    message: new Set(),
  }

  public closeCallCount = 0
  public sentMessages: string[] = []

  addEventListener(event: 'open' | 'close' | 'error' | 'message', handler: Listener): void {
    this.listeners[event].add(handler)
  }

  removeEventListener(event: 'open' | 'close' | 'error' | 'message', handler: Listener): void {
    this.listeners[event].delete(handler)
  }

  send(data: string): void {
    this.sentMessages.push(data)
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

function missionMessage(overrides: Record<string, unknown> = {}) {
  return {
    data: JSON.stringify({
      type: 'mission',
      sysId: 1,
      compId: 1,
      status: 'complete',
      items: [],
      activeIndex: null,
      reason: null,
      ...overrides,
    }),
  }
}

function homeMessage(overrides: Record<string, unknown> = {}) {
  return {
    data: JSON.stringify({
      type: 'home',
      sysId: 1,
      compId: 1,
      lat: 47.3977420,
      lon: 8.5455940,
      altMslM: 488,
      ...overrides,
    }),
  }
}

function linkModeMessage(overrides: Record<string, unknown> = {}) {
  return {
    data: JSON.stringify({
      type: 'linkMode',
      replayMode: true,
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
    const { stop } = startTelemetryStream(
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
    const { stop } = startTelemetryStream(
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
    const { stop } = startTelemetryStream(
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
    const { stop } = startTelemetryStream(
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
    const { stop } = startTelemetryStream(
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
    const { stop } = startTelemetryStream(
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

  it('dispatches mission, home, and linkMode frames to their matching handlers only', () => {
    const socket = new FakeSocket()
    const frames: WireFrame[] = []
    const missions: MissionWireFrame[] = []
    const homes: HomeWireFrame[] = []
    const linkModes: LinkModeWireFrame[] = []
    let decodeErrors = 0
    const { stop } = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      {
        onFrame: (frame) => frames.push(frame),
        onMission: (frame) => missions.push(frame),
        onHome: (frame) => homes.push(frame),
        onLinkMode: (frame) => linkModes.push(frame),
        onDecodeError: () => { decodeErrors += 1 },
      },
    )

    socket.emit('open')
    socket.emit('message', missionMessage())
    socket.emit('message', homeMessage())
    socket.emit('message', linkModeMessage())

    expect(missions).toHaveLength(1)
    expect(missions[0].status).toBe('complete')
    expect(homes).toHaveLength(1)
    expect(homes[0].lat).toBeCloseTo(47.397742)
    expect(linkModes).toHaveLength(1)
    expect(linkModes[0].replayMode).toBe(true)
    expect(frames).toHaveLength(0)
    expect(decodeErrors).toBe(0)

    stop()
  })

  it('skips undefined mission/home/linkMode handlers without erroring or falling back to onDecodeError', () => {
    const socket = new FakeSocket()
    const frames: WireFrame[] = []
    let decodeErrors = 0
    const { stop } = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: (frame) => frames.push(frame), onDecodeError: () => { decodeErrors += 1 } },
    )

    socket.emit('open')
    expect(() => socket.emit('message', missionMessage())).not.toThrow()
    expect(() => socket.emit('message', homeMessage())).not.toThrow()
    expect(() => socket.emit('message', linkModeMessage())).not.toThrow()

    expect(frames).toHaveLength(0)
    expect(decodeErrors).toBe(0)

    stop()
  })

  it('send() returns false and does not call the socket before open', () => {
    const socket = new FakeSocket()
    const { stop, send } = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: () => undefined },
    )

    const result = send('{"type":"requestMission"}')

    expect(result).toBe(false)
    expect(socket.sentMessages).toHaveLength(0)

    stop()
  })

  it('send() calls through to the socket and returns true once open', () => {
    const socket = new FakeSocket()
    const { stop, send } = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: () => undefined },
    )

    socket.emit('open')
    const result = send('{"type":"requestMission"}')

    expect(result).toBe(true)
    expect(socket.sentMessages).toEqual(['{"type":"requestMission"}'])

    stop()
  })

  it('send() returns false and does not call the socket after close', () => {
    const socket = new FakeSocket()
    const { stop, send } = startTelemetryStream(
      { url: 'ws://test', socketFactory: () => socket },
      { onFrame: () => undefined },
    )

    socket.emit('open')
    socket.emit('close')
    const result = send('{"type":"requestMission"}')

    expect(result).toBe(false)
    expect(socket.sentMessages).toHaveLength(0)

    stop()
  })
})
