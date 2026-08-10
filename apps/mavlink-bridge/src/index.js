import { WebSocketServer } from 'ws'
import { createBridgeCore } from './bridgeCore.js'
import { createJsonlRecorder } from './recording.js'
import { createReplayIngress } from './replayIngress.js'
import { createUdpIngress } from './udpIngress.js'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '0.0.0.0'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)
const WS_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_WS_PORT ?? '8080', 10)
const WS_PATH = process.env.MAVLINK_BRIDGE_WS_PATH ?? '/telemetry'
// Drop a system from the roster after this long without a packet (~10 missed 1Hz heartbeats).
const SYSTEM_TTL_MS = Number.parseInt(process.env.MAVLINK_BRIDGE_SYSTEM_TTL_MS ?? '10000', 10)

const RECORD_FILE = process.env.MAVLINK_BRIDGE_RECORD_FILE ?? null
const REPLAY_FILE = process.env.MAVLINK_BRIDGE_REPLAY_FILE ?? null
const REPLAY_SPEED = Number.parseFloat(process.env.MAVLINK_BRIDGE_REPLAY_SPEED ?? '1')
const REPLAY_LOOP = process.env.MAVLINK_BRIDGE_REPLAY_LOOP === '1'

const wsServer = new WebSocketServer({ port: WS_PORT, path: WS_PATH })
const core = createBridgeCore({ systemTtlMs: SYSTEM_TTL_MS })

// Ingress is chosen here and nowhere else: the core and the publish path are
// identical whether frames arrive from a socket or a recording.
const ingress = REPLAY_FILE === null
  ? createUdpIngress({ host: UDP_HOST, port: UDP_PORT })
  : createReplayIngress(REPLAY_FILE, { speed: REPLAY_SPEED, loop: REPLAY_LOOP })

const recorder = RECORD_FILE === null ? null : createJsonlRecorder(RECORD_FILE)

function publish(frame) {
  const payload = JSON.stringify(frame)

  wsServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload)
    }
  })
}

const tickTimer = setInterval(() => {
  core.tick()
}, 1000)

function reportSourceConflicts() {
  core.takeSourceConflicts().forEach(({ system, sources }) => {
    console.warn(`[mavlink-bridge] WARNING: system ${system} is transmitting from ${sources.length} sources: ${sources.join(', ')}`)
    console.warn('[mavlink-bridge] They merge into one aircraft with contradictory telemetry (expect a sawtooth track).')
    console.warn('[mavlink-bridge] If these are duplicate senders, stop the extras:  pkill -f sampleSender.js')
  })
}

const stopIngress = ingress.start((datagram, meta) => {
  recorder?.record(datagram)

  // Deliberately not forwarding the replay adapter's recorded timestamp: the TTL
  // sweep runs on the wall clock, so recorded times would age every system out
  // instantly. Determinism is exercised at the core level in the contract test.
  core.ingestDatagram(datagram, undefined, meta?.source).forEach(publish)
  reportSourceConflicts()
})

wsServer.on('listening', () => {
  console.log(`[mavlink-bridge] websocket listening at ws://localhost:${WS_PORT}${WS_PATH}`)
  console.log(`[mavlink-bridge] ingress: ${ingress.describe()}`)
  if (recorder !== null) {
    console.log(`[mavlink-bridge] recording to ${RECORD_FILE}`)
  }
})

wsServer.on('connection', () => {
  console.log(`[mavlink-bridge] websocket client connected (${wsServer.clients.size} clients, ${core.systemCount()} systems seen)`)
})

async function shutdown() {
  clearInterval(tickTimer)
  stopIngress()
  await recorder?.close()
  wsServer.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
