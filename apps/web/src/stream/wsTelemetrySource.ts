import {
    parseExternalTelemetryEnvelope,
    type ExternalTelemetryEnvelope,
    type StreamConnectionState,
} from './externalTypes'
import type { StreamHealthSnapshot } from './streamPorts'
import type { TelemetrySource } from './telemetrySource'

type MessageEventLike = { data: unknown }

export interface WebSocketLike {
  addEventListener: (event: 'open' | 'close' | 'error' | 'message', handler: (event: unknown) => void) => void
  removeEventListener: (event: 'open' | 'close' | 'error' | 'message', handler: (event: unknown) => void) => void
  close: () => void
}

export interface CreateWsTelemetrySourceOptions {
  url: string
  label?: string
  reconnectInitialMs?: number
  reconnectMaxMs?: number
  reconnectMultiplier?: number
  healthTickMs?: number
  socketFactory?: (url: string) => WebSocketLike
}

function buildDefaultStreamHealth(connectionState: StreamConnectionState): StreamHealthSnapshot {
  return {
    packetRateHz: 0,
    decodeErrorCount: 0,
    droppedPacketCount: 0,
    lastHeartbeatAgeMs: 0,
    connectionState,
  }
}

function createBrowserSocket(url: string): WebSocketLike {
  return new WebSocket(url)
}

function asEnvelope(rawData: unknown): ExternalTelemetryEnvelope | null {
  if (typeof rawData !== 'string') {
    return null
  }

  try {
    const payload = JSON.parse(rawData)
    return parseExternalTelemetryEnvelope(payload)
  } catch {
    return null
  }
}

function toHeartbeatAgeMs(lastHeartbeatAtMs: number | null, nowMs: number): number {
  if (lastHeartbeatAtMs === null) {
    return 0
  }

  const delta = nowMs - lastHeartbeatAtMs
  return delta < 0 ? 0 : delta
}

export function createWsTelemetrySource(options: CreateWsTelemetrySourceOptions): TelemetrySource {
  const {
    url,
    label = 'External stream (ws)',
    reconnectInitialMs = 500,
    reconnectMaxMs = 5000,
    reconnectMultiplier = 1.8,
    healthTickMs = 1000,
    socketFactory = createBrowserSocket,
  } = options

  return {
    id: 'ws-external',
    label,
    intervalMs: 0,
    start: (onSample, onHealthUpdate) => {
      let disposed = false
      let socket: WebSocketLike | null = null
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null
      let healthTimer: ReturnType<typeof setInterval> | null = null
      let reconnectDelayMs = reconnectInitialMs
      let packetsSinceLastTick = 0
      let decodeErrorCount = 0
      let droppedPacketCount = 0
      let lastHeartbeatAtMs: number | null = null
      let connectionState: StreamConnectionState = 'connecting'

      const publishHealth = () => {
        onHealthUpdate?.({
          packetRateHz: packetsSinceLastTick,
          decodeErrorCount,
          droppedPacketCount,
          lastHeartbeatAgeMs: toHeartbeatAgeMs(lastHeartbeatAtMs, Date.now()),
          connectionState,
        })
        packetsSinceLastTick = 0
      }

      const setConnectionState = (next: StreamConnectionState) => {
        connectionState = next
        publishHealth()
      }

      const scheduleReconnect = () => {
        if (disposed || reconnectTimer !== null) {
          return
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, reconnectDelayMs)

        reconnectDelayMs = Math.min(
          reconnectMaxMs,
          Math.max(reconnectInitialMs, Math.round(reconnectDelayMs * reconnectMultiplier)),
        )
      }

      const onOpen = () => {
        reconnectDelayMs = reconnectInitialMs
        setConnectionState('open')
      }

      const onClose = () => {
        setConnectionState('closed')
        scheduleReconnect()
      }

      const onError = () => {
        setConnectionState('error')
      }

      const onMessage = (event: unknown) => {
        const candidate = event as MessageEventLike
        const envelope = asEnvelope(candidate?.data)

        if (!envelope) {
          decodeErrorCount += 1
          droppedPacketCount += 1
          publishHealth()
          return
        }

        packetsSinceLastTick += 1

        if (envelope.messageName === 'HEARTBEAT') {
          lastHeartbeatAtMs = Date.now()
        }

        onSample(envelope.payload)

        if (envelope.health?.decodeErrorCount !== undefined) {
          decodeErrorCount = envelope.health.decodeErrorCount
        }

        if (envelope.health?.droppedPacketCount !== undefined) {
          droppedPacketCount = envelope.health.droppedPacketCount
        }
      }

      const connect = () => {
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

      healthTimer = setInterval(publishHealth, healthTickMs)
      onHealthUpdate?.(buildDefaultStreamHealth('connecting'))
      connect()

      return () => {
        disposed = true

        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }

        if (healthTimer !== null) {
          clearInterval(healthTimer)
          healthTimer = null
        }

        if (socket) {
          socket.removeEventListener('open', onOpen)
          socket.removeEventListener('close', onClose)
          socket.removeEventListener('error', onError)
          socket.removeEventListener('message', onMessage)
          socket.close()
          socket = null
        }

        onHealthUpdate?.(buildDefaultStreamHealth('closed'))
      }
    },
  }
}
