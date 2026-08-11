import type { TelemetrySample } from '@flight-path-hud/hud-ui'
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

export interface SystemFilter {
  sysId: number
  compId: number
}

export interface CreateWsTelemetrySourceOptions {
  url: string
  label?: string
  /** Read per message so switching the selected system does not force a reconnect. */
  getSystemFilter?: () => SystemFilter | null
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
    messageRates: [],
    systems: [],
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

function mergeSection<T extends object>(previousSection: T | undefined, nextSection: T | undefined): T | undefined {
  if (nextSection === undefined) {
    return previousSection
  }

  if (previousSection === undefined) {
    return nextSection
  }

  // Sanitizing sets absent fields to an explicit `undefined`, so a plain spread
  // would erase known-good siblings (e.g. a GLOBAL_POSITION_INT without lat/lon
  // wiping the last fix). Carry the previous value forward for those instead.
  const merged = { ...previousSection } as Record<string, unknown>
  for (const [key, value] of Object.entries(nextSection)) {
    if (value !== undefined) {
      merged[key] = value
    }
  }

  return merged as T
}

function toSystemKey(sysId: number, compId: number): string {
  return `${sysId}:${compId}`
}

function mergeTelemetrySample(previousSample: TelemetrySample | null, nextSample: TelemetrySample): TelemetrySample {
  return {
    timestampMs: nextSample.timestampMs,
    attitude: mergeSection(previousSample?.attitude, nextSample.attitude),
    vfrHud: mergeSection(previousSample?.vfrHud, nextSample.vfrHud),
    globalPositionInt: mergeSection(previousSample?.globalPositionInt, nextSample.globalPositionInt),
    gpsRawInt: mergeSection(previousSample?.gpsRawInt, nextSample.gpsRawInt),
  }
}

export function createWsTelemetrySource(options: CreateWsTelemetrySourceOptions): TelemetrySource {
  const {
    url,
    label = 'External stream (ws)',
    getSystemFilter,
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
      let packetRateHz = 0
      let decodeErrorCount = 0
      let droppedPacketCount = 0
      let lastHeartbeatAtMs: number | null = null
      let connectionState: StreamConnectionState = 'connecting'
      let activeSysId: number | undefined
      let activeCompId: number | undefined
      let messageRates: StreamHealthSnapshot['messageRates'] = []
      let systems: StreamHealthSnapshot['systems'] = []

      // Partial messages merge per source system, so two vehicles never fuse into one sample.
      const sampleBySystem = new Map<string, TelemetrySample>()

      const buildHealthSnapshot = (): StreamHealthSnapshot => ({
        packetRateHz,
        decodeErrorCount,
        droppedPacketCount,
        lastHeartbeatAgeMs: toHeartbeatAgeMs(lastHeartbeatAtMs, Date.now()),
        connectionState,
        activeSysId,
        activeCompId,
        messageRates,
        systems,
      })

      const emitHealth = () => {
        onHealthUpdate?.(buildHealthSnapshot())
      }

      const onHealthTick = () => {
        packetRateHz = packetsSinceLastTick
        packetsSinceLastTick = 0
        emitHealth()
      }

      const setConnectionState = (next: StreamConnectionState) => {
        connectionState = next
        emitHealth()
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
          emitHealth()
          return
        }

        packetsSinceLastTick += 1
        messageRates = envelope.health?.messageRates ?? messageRates
        systems = envelope.health?.systems ?? systems

        // The bridge counters are authoritative, so absorb them even for systems we filter out.
        if (envelope.health?.decodeErrorCount !== undefined) {
          decodeErrorCount = envelope.health.decodeErrorCount
        }

        if (envelope.health?.droppedPacketCount !== undefined) {
          droppedPacketCount = envelope.health.droppedPacketCount
        }

        if (envelope.messageName === 'HEARTBEAT') {
          lastHeartbeatAtMs = Date.now()
        }

        const systemFilter = getSystemFilter?.() ?? null

        if (
          systemFilter !== null
          && (envelope.sysId !== systemFilter.sysId || envelope.compId !== systemFilter.compId)
        ) {
          emitHealth()
          return
        }

        activeSysId = envelope.sysId
        activeCompId = envelope.compId

        const key = toSystemKey(envelope.sysId, envelope.compId)
        const mergedSample = mergeTelemetrySample(sampleBySystem.get(key) ?? null, envelope.payload)
        sampleBySystem.set(key, mergedSample)
        onSample(mergedSample)

        emitHealth()
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

      healthTimer = setInterval(onHealthTick, healthTickMs)
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
