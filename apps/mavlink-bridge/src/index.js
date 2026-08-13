import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { createBridgeCore } from './bridgeCore.js'
import { createJsonlRecorder, pruneRecordings } from './recording.js'
import { createReplayIngress } from './replayIngress.js'
import { createUdpIngress } from './udpIngress.js'
import { createMissionRouter } from './missionRouter.js'
import { createCommandRouter } from './commandRouter.js'
import { createParameterRouter } from './parameterRouter.js'
import { createParameterListRouter } from './parameterListRouter.js'
import { createMessageRequestRouter } from './messageRequestRouter.js'
import { createMessageIntervalRouter } from './messageIntervalRouter.js'
import { createParameterWriteRouter } from './parameterWriteRouter.js'
import { createMissionUploadRouter } from './missionUploadRouter.js'
import { createFlightStateTracker } from './flightStateTracker.js'
import { createModeChangeRouter } from './modeChangeRouter.js'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '0.0.0.0'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)
const WS_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_WS_PORT ?? '8080', 10)
const WS_PATH = process.env.MAVLINK_BRIDGE_WS_PATH ?? '/telemetry'
// Drop a system from the roster after this long without a packet (~10 missed 1Hz heartbeats).
const SYSTEM_TTL_MS = Number.parseInt(process.env.MAVLINK_BRIDGE_SYSTEM_TTL_MS ?? '10000', 10)

/*
 * Recording is on by default. It is only safe as a default because the retention
 * policy below bounds it: a per-run byte cap plus an age/size sweep at startup.
 * Set MAVLINK_BRIDGE_RECORD=0 to turn it off.
 */
const RECORD_ENABLED = process.env.MAVLINK_BRIDGE_RECORD !== '0'
const RECORD_DIR = process.env.MAVLINK_BRIDGE_RECORD_DIR ?? 'recordings'
const RECORD_MAX_MB = Number.parseFloat(process.env.MAVLINK_BRIDGE_RECORD_MAX_MB ?? '256')
const RECORD_RETAIN_DAYS = Number.parseFloat(process.env.MAVLINK_BRIDGE_RECORD_RETAIN_DAYS ?? '7')
const RECORD_TOTAL_MAX_MB = Number.parseFloat(process.env.MAVLINK_BRIDGE_RECORD_TOTAL_MAX_MB ?? '128')

/** Timestamped per run: overwriting one file would make retention meaningless. */
function defaultRecordPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
  return path.join(RECORD_DIR, `session-${stamp}.jsonl`)
}

const REPLAY_FILE = process.env.MAVLINK_BRIDGE_REPLAY_FILE ?? null

// Never record a replay: it would duplicate an existing recording under a new
// name and quietly double what retention has to manage.
const RECORD_FILE = RECORD_ENABLED && REPLAY_FILE === null
  ? (process.env.MAVLINK_BRIDGE_RECORD_FILE ?? defaultRecordPath())
  : null
const REPLAY_SPEED = Number.parseFloat(process.env.MAVLINK_BRIDGE_REPLAY_SPEED ?? '1')
const REPLAY_LOOP = process.env.MAVLINK_BRIDGE_REPLAY_LOOP === '1'

const wsServer = new WebSocketServer({ port: WS_PORT, path: WS_PATH })
const core = createBridgeCore({ systemTtlMs: SYSTEM_TTL_MS })
const flightStateTracker = createFlightStateTracker()

// Ingress is chosen here and nowhere else: the core and the publish path are
// identical whether frames arrive from a socket or a recording.
const ingress = REPLAY_FILE === null
  ? createUdpIngress({ host: UDP_HOST, port: UDP_PORT })
  : createReplayIngress(REPLAY_FILE, { speed: REPLAY_SPEED, loop: REPLAY_LOOP })

const missionRouter = createMissionRouter({
  send: (sysId, compId, buffer) => ingress.sendTo?.(sysId, compId, buffer),
  canSend: (sysId, compId) => ingress.hasRoute?.(sysId, compId) === true,
  isLive: () => typeof ingress.sendTo === 'function',
})

const commandRouter = createCommandRouter({
  // Stage 0 intentionally ships with no production command families. Each
  // future family must be registered here behind its own evidence gate.
  definitions: new Map(),
  send: (sysId, compId, buffer) => ingress.sendTo?.(sysId, compId, buffer),
  canSend: (sysId, compId) => ingress.hasRoute?.(sysId, compId) === true,
  isLive: () => typeof ingress.sendTo === 'function',
  recordEvent: (event) => recorder?.recordEvent(event),
})

const parameterRouter = createParameterRouter({
  send: (sysId, compId, buffer) => ingress.sendTo?.(sysId, compId, buffer),
  canSend: (sysId, compId) => ingress.hasRoute?.(sysId, compId) === true,
  isLive: () => typeof ingress.sendTo === 'function',
  recordEvent: (event) => recorder?.recordEvent(event),
})
const parameterListRouter = createParameterListRouter({
  send: (sysId, compId, buffer) => ingress.sendTo?.(sysId, compId, buffer),
  canSend: (sysId, compId) => ingress.hasRoute?.(sysId, compId) === true,
  isLive: () => typeof ingress.sendTo === 'function', recordEvent: (event) => recorder?.recordEvent(event),
})
const messageRequestRouter = createMessageRequestRouter({ send: (s,c,b)=>ingress.sendTo?.(s,c,b), canSend: (s,c)=>ingress.hasRoute?.(s,c)===true, isLive: ()=>typeof ingress.sendTo==='function', recordEvent: (e)=>recorder?.recordEvent(e) })
const messageIntervalRouter = createMessageIntervalRouter({ send:(s,c,b)=>ingress.sendTo?.(s,c,b), canSend:(s,c)=>ingress.hasRoute?.(s,c)===true,
  isLive:()=>typeof ingress.sendTo==='function', enabled:()=>process.env.MAVLINK_BRIDGE_ENABLE_MESSAGE_INTERVAL==='1', recordEvent:e=>recorder?.recordEvent(e) })
const parameterWriteRouter = createParameterWriteRouter({ send:(s,c,b)=>ingress.sendTo?.(s,c,b), canSend:(s,c)=>ingress.hasRoute?.(s,c)===true,
  isLive:()=>typeof ingress.sendTo==='function', enabled:()=>process.env.MAVLINK_BRIDGE_ENABLE_PARAMETER_WRITE==='1', recordEvent:e=>recorder?.recordEvent(e) })
const missionUploadRouter = createMissionUploadRouter({ send:(s,c,b)=>ingress.sendTo?.(s,c,b), canSend:(s,c)=>ingress.hasRoute?.(s,c)===true,
  isLive:()=>typeof ingress.sendTo==='function', enabled:()=>process.env.MAVLINK_BRIDGE_ENABLE_MISSION_UPLOAD==='1', recordEvent:e=>recorder?.recordEvent(e) })
const modeChangeRouter = createModeChangeRouter({ send:(s,c,b)=>ingress.sendTo?.(s,c,b), canSend:(s,c)=>ingress.hasRoute?.(s,c)===true,
  getFlightState:(s,c)=>flightStateTracker.getFreshState(s,c), isLive:()=>typeof ingress.sendTo==='function',
  enabled:()=>process.env.MAVLINK_BRIDGE_ENABLE_MODE_CHANGE==='1', recordEvent:e=>recorder?.recordEvent(e) })

const MISSION_MESSAGE_NAMES = new Set(['MISSION_COUNT', 'MISSION_ITEM_INT', 'MISSION_CURRENT', 'MISSION_ACK', 'MISSION_REQUEST', 'MISSION_REQUEST_INT'])

function startRecording() {
  if (RECORD_FILE === null) {
    return null
  }

  const directory = path.dirname(RECORD_FILE)
  fs.mkdirSync(directory, { recursive: true })

  const { removed, keptBytes } = pruneRecordings(directory, {
    maxAgeMs: RECORD_RETAIN_DAYS * 24 * 60 * 60 * 1000,
    maxTotalBytes: RECORD_TOTAL_MAX_MB * 1e6,
    excludePath: RECORD_FILE,
  })

  // Say what was deleted; quietly discarding flight data is not acceptable.
  removed.forEach(({ name, sizeBytes, reason }) => {
    console.log(`[mavlink-bridge] pruned recording ${name} (${(sizeBytes / 1e6).toFixed(1)} MB, ${reason})`)
  })
  console.log(`[mavlink-bridge] recordings retained: ${(keptBytes / 1e6).toFixed(1)} MB in ${directory}`)

  return createJsonlRecorder(RECORD_FILE, { maxBytes: RECORD_MAX_MB * 1e6 })
}

const recorder = startRecording()

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
  // The bridge roster and outbound routing share one lifetime. A vehicle that
  // aged out must not remain a stale target for a later mission request.
  ingress.expireRoutes?.(SYSTEM_TTL_MS)
}, 1000)

function reportSourceConflicts() {
  core.takeSourceConflicts().forEach(({ system, sources }) => {
    console.warn(`[mavlink-bridge] WARNING: system ${system} is transmitting from ${sources.length} sources: ${sources.join(', ')}`)
    console.warn('[mavlink-bridge] They merge into one aircraft with contradictory telemetry (expect a sawtooth track).')
    console.warn('[mavlink-bridge] If these are duplicate senders, stop the extras:  pkill -f mockFleetRunner.js')
  })
}

const stopIngress = ingress.start((datagram, meta) => {
  recorder?.record(datagram)

  // Deliberately not forwarding the replay adapter's recorded timestamp: the TTL
  // sweep runs on the wall clock, so recorded times would age every system out
  // instantly. Determinism is exercised at the core level in the contract test.
  core.ingestDatagram(datagram, undefined, meta?.source).forEach((envelope) => {
    if (meta?.source !== undefined) {
      ingress.rememberSystem?.(envelope.sysId, envelope.compId, meta.source)
    }
    const flightState = flightStateTracker.ingestEnvelope(envelope)
    if (flightState !== null) publish(flightState)
    const modeFrame = modeChangeRouter.ingestEnvelope(envelope)
    if (modeFrame !== null) publish(modeFrame)
    if (envelope.messageName === 'COMMAND_ACK') {
      const frame = commandRouter.ingestEnvelope(envelope)
      if (frame !== null) publish(frame)
    }
    const requestedFrame = messageRequestRouter.ingestEnvelope(envelope)
    if (requestedFrame !== null) publish(requestedFrame)
    const intervalFrame = messageIntervalRouter.ingestEnvelope(envelope)
    if (intervalFrame !== null) publish(intervalFrame)
    const uploadFrame = missionUploadRouter.ingestEnvelope(envelope)
    if (uploadFrame !== null) publish(uploadFrame)
    if (envelope.messageName === 'PARAM_VALUE') {
      const frame = parameterRouter.ingestEnvelope(envelope)
      if (frame !== null) publish(frame)
      const listFrame = parameterListRouter.ingestEnvelope(envelope)
      if (listFrame !== null) publish(listFrame)
      const writeFrame = parameterWriteRouter.ingestEnvelope(envelope)
      if (writeFrame !== null) publish(writeFrame)
    }
    if (envelope.messageName === 'HOME_POSITION' || MISSION_MESSAGE_NAMES.has(envelope.messageName)) {
      const frame = missionRouter.ingestEnvelope(envelope)
      if (frame !== null) {
        publish(frame)
      }
      return
    }

    publish(envelope)
  })
  reportSourceConflicts()
}, (event) => {
  const commandFrame = commandRouter.ingestRecordedEvent(event)
  if (commandFrame !== null) publish(commandFrame)
  const parameterFrame = parameterRouter.ingestRecordedEvent(event)
  if (parameterFrame !== null) publish(parameterFrame)
  const listFrame = parameterListRouter.ingestRecordedEvent(event)
  if (listFrame !== null) publish(listFrame)
  const requestedFrame = messageRequestRouter.ingestRecordedEvent(event)
  if (requestedFrame !== null) publish(requestedFrame)
  const intervalFrame = messageIntervalRouter.ingestRecordedEvent(event)
  if (intervalFrame !== null) publish(intervalFrame)
  const writeFrame = parameterWriteRouter.ingestRecordedEvent(event)
  if (writeFrame !== null) publish(writeFrame)
  const uploadFrame = missionUploadRouter.ingestRecordedEvent(event)
  if (uploadFrame !== null) publish(uploadFrame)
  const modeFrame = modeChangeRouter.ingestRecordedEvent(event)
  if (modeFrame !== null) publish(modeFrame)
})

wsServer.on('listening', () => {
  console.log(`[mavlink-bridge] websocket listening at ws://localhost:${WS_PORT}${WS_PATH}`)
  console.log(`[mavlink-bridge] ingress: ${ingress.describe()}`)
  if (recorder !== null) {
    console.log(`[mavlink-bridge] recording to ${RECORD_FILE}`)
  }
})

wsServer.on('connection', (ws) => {
  console.log(`[mavlink-bridge] websocket client connected (${wsServer.clients.size} clients, ${core.systemCount()} systems seen)`)

  ws.send(JSON.stringify({ type: 'linkMode', replayMode: REPLAY_FILE !== null }))
  missionRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  commandRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  parameterRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  parameterListRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  messageRequestRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  messageIntervalRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  parameterWriteRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  missionUploadRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))
  flightStateTracker.snapshot().forEach((frame) => ws.send(JSON.stringify(frame)))
  modeChangeRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))

  ws.on('message', (raw) => {
    let message = null
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Belt and braces alongside missionRouter's own input validation: this
    // handler runs on unauthenticated input, and an uncaught throw here takes
    // the whole bridge down for every connected client.
    try {
      const frame = missionRouter.handleClientMessage(message)
      if (frame !== null) {
        publish(frame)
      }
      const commandFrame = commandRouter.handleClientMessage(message)
      if (commandFrame !== null) publish(commandFrame)
      const parameterFrame = parameterRouter.handleClientMessage(message)
      if (parameterFrame !== null) publish(parameterFrame)
      const listFrame = parameterListRouter.handleClientMessage(message)
      if (listFrame !== null) publish(listFrame)
      const requestedFrame = messageRequestRouter.handleClientMessage(message)
      if (requestedFrame !== null) publish(requestedFrame)
      const intervalFrame = messageIntervalRouter.handleClientMessage(message)
      if (intervalFrame !== null) publish(intervalFrame)
      const writeFrame = parameterWriteRouter.handleClientMessage(message)
      if (writeFrame !== null) publish(writeFrame)
      const uploadFrame = missionUploadRouter.handleClientMessage(message)
      if (uploadFrame !== null) publish(uploadFrame)
      const modeFrame = modeChangeRouter.handleClientMessage(message)
      if (modeFrame !== null) publish(modeFrame)
    } catch (error) {
      console.error(`[mavlink-bridge] client message rejected: ${error?.message ?? error}`)
    }
  })
})

const missionTickTimer = setInterval(() => {
  missionRouter.tick().forEach(publish)
  commandRouter.tick().forEach(publish)
  parameterRouter.tick().forEach(publish)
  parameterListRouter.tick().forEach(publish)
  messageRequestRouter.tick().forEach(publish)
  messageIntervalRouter.tick().forEach(publish)
  parameterWriteRouter.tick().forEach(publish)
  missionUploadRouter.tick().forEach(publish)
  modeChangeRouter.tick().forEach(publish)
}, 100)

async function shutdown() {
  clearInterval(tickTimer)
  clearInterval(missionTickTimer)
  stopIngress()
  await recorder?.close()
  wsServer.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
