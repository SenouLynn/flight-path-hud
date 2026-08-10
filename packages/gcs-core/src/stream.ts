/**
 * Reconnecting client for the bridge's telemetry socket.
 *
 * The socket is injected rather than constructed, which is what lets this run in
 * a browser, under Node for log consumption, and in tests against a fake — the
 * same seam the HUD's ws source uses.
 *
 * It deliberately owns no vehicle or track state: it emits parsed frames and
 * connection state, and the caller folds.
 */

import { parseWireMessage, type WireFrame } from './wire'

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'error'

export interface SocketLike {
  addEventListener: (event: 'open' | 'close' | 'error' | 'message', handler: (event: unknown) => void) => void
  removeEventListener: (event: 'open' | 'close' | 'error' | 'message', handler: (event: unknown) => void) => void
  close: () => void
}

export interface StreamHandlers {
  onFrame: (frame: WireFrame) => void
  onConnectionState?: (state: ConnectionState) => void
  /** Frames that failed to parse — surfaced so a UI can show a decode-error count. */
  onDecodeError?: () => void
}

export interface StreamOptions {
  url: string
  /**
   * Required, not defaulted: this package must not assume a browser. The caller
   * supplies `new WebSocket(url)` in a browser, a `ws` socket under Node, or a
   * fake in tests.
   */
  socketFactory: (url: string) => SocketLike
  reconnectInitialMs?: number
  reconnectMaxMs?: number
  reconnectMultiplier?: number
}

/**
 * Timers are host APIs, absent from the ES lib and typed differently by the DOM
 * and Node lib. Reaching through `globalThis` with a structural type keeps this
 * module free of both.
 */
type TimerHandle = ReturnType<typeof scheduleTimeout>

const hostTimers = globalThis as unknown as {
  setTimeout: (handler: () => void, timeoutMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

function scheduleTimeout(handler: () => void, timeoutMs: number): unknown {
  return hostTimers.setTimeout(handler, timeoutMs)
}

function cancelTimeout(handle: unknown): void {
  hostTimers.clearTimeout(handle)
}

/**
 * Connect and start delivering frames. Returns a stop function that tears down
 * listeners, cancels any pending reconnect, and closes the socket.
 */
export function startTelemetryStream(options: StreamOptions, handlers: StreamHandlers): () => void {
  const {
    url,
    socketFactory,
    reconnectInitialMs = 500,
    reconnectMaxMs = 5000,
    reconnectMultiplier = 1.8,
  } = options

  let disposed = false
  let socket: SocketLike | null = null
  let reconnectTimer: TimerHandle | null = null
  let reconnectDelayMs = reconnectInitialMs

  const setConnectionState = (state: ConnectionState) => {
    handlers.onConnectionState?.(state)
  }

  const onMessage = (event: unknown) => {
    const frame = parseWireMessage((event as { data?: unknown })?.data)

    if (frame === null) {
      handlers.onDecodeError?.()
      return
    }

    handlers.onFrame(frame)
  }

  const detach = () => {
    if (socket === null) {
      return
    }

    socket.removeEventListener('open', onOpen)
    socket.removeEventListener('close', onClose)
    socket.removeEventListener('error', onError)
    socket.removeEventListener('message', onMessage)
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer !== null) {
      return
    }

    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectDelayMs)

    reconnectDelayMs = Math.min(
      reconnectMaxMs,
      Math.max(reconnectInitialMs, Math.round(reconnectDelayMs * reconnectMultiplier)),
    )
  }

  function onOpen() {
    reconnectDelayMs = reconnectInitialMs
    setConnectionState('open')
  }

  function onClose() {
    setConnectionState('closed')
    scheduleReconnect()
  }

  function onError() {
    setConnectionState('error')
  }

  function connect() {
    if (disposed) {
      return
    }

    setConnectionState('connecting')
    socket = socketFactory(url)
    socket.addEventListener('open', onOpen)
    socket.addEventListener('close', onClose)
    socket.addEventListener('error', onError)
    socket.addEventListener('message', onMessage)
  }

  connect()

  return () => {
    disposed = true

    if (reconnectTimer !== null) {
      cancelTimeout(reconnectTimer)
      reconnectTimer = null
    }

    detach()
    socket?.close()
    socket = null
    setConnectionState('closed')
  }
}
