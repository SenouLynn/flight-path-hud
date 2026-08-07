import dgram from 'node:dgram'
import { WebSocketServer } from 'ws'
import { parseIncomingDatagram } from './normalize.js'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '0.0.0.0'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)
const WS_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_WS_PORT ?? '8080', 10)
const WS_PATH = process.env.MAVLINK_BRIDGE_WS_PATH ?? '/telemetry'
// Drop a system from the roster after this long without a packet (~10 missed 1Hz heartbeats).
const SYSTEM_TTL_MS = Number.parseInt(process.env.MAVLINK_BRIDGE_SYSTEM_TTL_MS ?? '10000', 10)

const udpSocket = dgram.createSocket('udp4')
const wsServer = new WebSocketServer({ port: WS_PORT, path: WS_PATH })

let packetCount = 0
let decodeErrorCount = 0
let droppedPacketCount = 0
let packetsSinceTick = 0
let packetRateHz = 0
let messageRates = []

const messageCounts = new Map()
const systems = new Map()

setInterval(() => {
  packetRateHz = packetsSinceTick
  packetsSinceTick = 0

  messageRates = [...messageCounts.entries()]
    .map(([messageName, rateHz]) => ({ messageName, rateHz }))
    .sort((left, right) => right.rateHz - left.rateHz || left.messageName.localeCompare(right.messageName))

  messageCounts.clear()

  const staleBeforeMs = Date.now() - SYSTEM_TTL_MS
  systems.forEach((system, key) => {
    if (system.lastSeenTimestampMs < staleBeforeMs) {
      systems.delete(key)
    }
  })
}, 1000)

function systemKey(sysId, compId) {
  return `${sysId}:${compId}`
}

function observeSystem(envelope) {
  systems.set(systemKey(envelope.sysId, envelope.compId), {
    sysId: envelope.sysId,
    compId: envelope.compId,
    // Bridge-local clock: a JSON sender's recvTimestampMs is self-reported and
    // would make TTL eviction hostage to its clock skew.
    lastSeenTimestampMs: Date.now(),
  })
}

function buildSystemsSnapshot() {
  return [...systems.values()].sort((left, right) => {
    if (left.sysId !== right.sysId) {
      return left.sysId - right.sysId
    }

    return left.compId - right.compId
  })
}

function broadcastEnvelope(envelope) {
  const frame = JSON.stringify({
    ...envelope,
    health: {
      packetRateHz,
      decodeErrorCount,
      droppedPacketCount,
      messageRates,
      systems: buildSystemsSnapshot(),
    },
  })

  wsServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(frame)
    }
  })
}

udpSocket.on('message', (msg) => {
  const result = parseIncomingDatagram(msg)

  if (result.decodeErrors > 0) {
    decodeErrorCount += result.decodeErrors
    droppedPacketCount += result.decodeErrors
  }

  if (result.envelopes.length === 0) {
    return
  }

  result.envelopes.forEach((envelope) => {
    packetCount += 1
    packetsSinceTick += 1
    messageCounts.set(envelope.messageName, (messageCounts.get(envelope.messageName) ?? 0) + 1)
    observeSystem(envelope)

    // Consumers validate sequence as a uint8, so the synthesised fallback has to wrap like the wire field.
    const sequence = envelope.sequence > 0 ? envelope.sequence : packetCount % 256

    broadcastEnvelope({
      ...envelope,
      sequence,
    })
  })
})

udpSocket.on('error', (err) => {
  console.error(`[mavlink-bridge] UDP error: ${err.message}`)
})

wsServer.on('listening', () => {
  console.log(`[mavlink-bridge] websocket listening at ws://localhost:${WS_PORT}${WS_PATH}`)
})

wsServer.on('connection', () => {
  console.log(`[mavlink-bridge] websocket client connected (${wsServer.clients.size} clients, ${systems.size} systems seen)`)
})

udpSocket.bind(UDP_PORT, UDP_HOST, () => {
  console.log(`[mavlink-bridge] udp listening on ${UDP_HOST}:${UDP_PORT}`)
})
