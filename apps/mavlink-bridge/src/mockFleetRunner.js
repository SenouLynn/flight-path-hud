/**
 * Executable wrapper around createMockFleet: owns the socket, the tick timer and
 * the single-instance lock. All flight behaviour lives in flightProfiles.js, all
 * message shaping in mockFleet.js, all roster data in mockNodes.js — this file is
 * only transport.
 *
 * Replaces the original sampleSender.js, which hosted exactly one vehicle.
 */

import dgram from 'node:dgram'
import { createMockFleet } from './mockFleet.js'
import { MOCK_NODES, selectNodes } from './mockNodes.js'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '127.0.0.1'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)
// Fixed source port, used as a single-instance lock (see socket.bind below).
const LOCK_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_SAMPLE_PORT ?? '14549', 10)
const TICK_MS = Number.parseInt(process.env.MAVLINK_BRIDGE_MOCK_TICK_MS ?? '150', 10)

/**
 * Comma-separated node ids, e.g. `MAVLINK_BRIDGE_MOCK_NODES=snake-01` for the
 * single-stream case. Unset flies the whole roster.
 */
const NODE_SELECTION = process.env.MAVLINK_BRIDGE_MOCK_NODES ?? ''

let nodes
try {
  nodes = selectNodes(NODE_SELECTION, MOCK_NODES)
} catch (error) {
  console.error(`[mavlink-bridge mock] ${error.message}`)
  process.exit(1)
}

const fleet = createMockFleet({ nodes })
const socket = dgram.createSocket('udp4')

/*
 * Binding a fixed source port doubles as a single-instance lock. Two fleets both
 * claim the same sysIds, so the client merges each pair into one aircraft flying
 * two tracks at once — a sawtooth that looks like a rendering bug. Fail loudly
 * instead.
 */
socket.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[mavlink-bridge mock] a mock fleet is already running (lock port ${LOCK_PORT} is taken).`)
    console.error('[mavlink-bridge mock] Two fleets would merge into contradictory vehicles. Refusing to start.')
    console.error('[mavlink-bridge mock] Stop the other one first:  pkill -f mockFleetRunner.js')
  } else {
    console.error(`[mavlink-bridge mock] socket error: ${error.message}`)
  }

  process.exit(1)
})

socket.on('message', (datagram, rinfo) => {
  fleet.handleMissionRequest(datagram).forEach((frame) => {
    socket.send(frame, rinfo.port, rinfo.address)
  })
})

let timer = null

socket.bind(LOCK_PORT, () => {
  console.log(`[mavlink-bridge mock] sending UDP envelopes to ${UDP_HOST}:${UDP_PORT} (from :${LOCK_PORT})`)
  fleet.describe().forEach((line) => console.log(`[mavlink-bridge mock]   ${line}`))

  timer = setInterval(() => {
    fleet.tick().forEach((frame) => {
      socket.send(JSON.stringify(frame), UDP_PORT, UDP_HOST)
    })
  }, TICK_MS)
})

process.on('SIGINT', () => {
  if (timer !== null) {
    clearInterval(timer)
  }
  socket.close()
  process.exit(0)
})
