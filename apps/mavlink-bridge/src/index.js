import dgram from 'node:dgram'
import { WebSocketServer } from 'ws'
import { parseIncomingDatagram } from './normalize.js'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '0.0.0.0'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)
const WS_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_WS_PORT ?? '8080', 10)
const WS_PATH = process.env.MAVLINK_BRIDGE_WS_PATH ?? '/telemetry'

const udpSocket = dgram.createSocket('udp4')
const wsServer = new WebSocketServer({ port: WS_PORT, path: WS_PATH })

let packetCount = 0
let decodeErrorCount = 0
let droppedPacketCount = 0
let packetsSinceTick = 0
let packetRateHz = 0

setInterval(() => {
  packetRateHz = packetsSinceTick
  packetsSinceTick = 0
}, 1000)

function broadcastEnvelope(envelope) {
  const frame = JSON.stringify({
    ...envelope,
    health: {
      packetRateHz,
      decodeErrorCount,
      droppedPacketCount,
    },
  })

  wsServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(frame)
    }
  })
}

udpSocket.on('message', (msg) => {
  const envelope = parseIncomingDatagram(msg)

  if (envelope === null) {
    decodeErrorCount += 1
    droppedPacketCount += 1
    return
  }

  packetCount += 1
  packetsSinceTick += 1

  const sequence = envelope.sequence > 0 ? envelope.sequence : packetCount

  broadcastEnvelope({
    ...envelope,
    sequence,
  })
})

udpSocket.on('error', (err) => {
  console.error(`[mavlink-bridge] UDP error: ${err.message}`)
})

wsServer.on('listening', () => {
  console.log(`[mavlink-bridge] websocket listening at ws://localhost:${WS_PORT}${WS_PATH}`)
})

wsServer.on('connection', () => {
  console.log(`[mavlink-bridge] websocket client connected (${wsServer.clients.size} clients)`)
})

udpSocket.bind(UDP_PORT, UDP_HOST, () => {
  console.log(`[mavlink-bridge] udp listening on ${UDP_HOST}:${UDP_PORT}`)
})
