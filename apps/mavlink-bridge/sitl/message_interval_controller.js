#!/usr/bin/env node
import { assertCadence } from '../src/cadenceAcceptance.js'

const WS_URL = process.env.BRIDGE_WS_URL ?? 'ws://bridge:8080/telemetry'
const MESSAGE_NAME = 'ATTITUDE'
const SAMPLE_COUNT = Number.parseInt(process.env.SAMPLE_COUNT ?? '13', 10)
const targets = [
  { name: 'copter', sysId: 1, compId: 1, intervalUs: 500_000, timestamps: [] },
  // MAVProxy's legacy stream request keeps Plane ATTITUDE near 4 Hz; unlike
  // Copter, Plane does not let a slower per-message request suppress that
  // aggregate stream. Exercise an increase here so the requested 10 Hz wins.
  { name: 'plane', sysId: 2, compId: 1, intervalUs: 100_000, timestamps: [] },
]
let socket = null
let stopping = false
const statuses = new Map()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connect(deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const ws = new WebSocket(WS_URL)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect timeout')), 3000)
        ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connect failed')) }, { once: true })
      })
      return ws
    } catch {
      await delay(1000)
    }
  }
  throw new Error(`bridge WebSocket unavailable at ${WS_URL}`)
}

function sendInterval(target, intervalUs, suffix) {
  const requestId = `${target.name}-${suffix}-${Date.now()}`
  socket.send(JSON.stringify({ type: 'setMessageInterval', requestId,
    sysId: target.sysId, compId: target.compId, messageName: MESSAGE_NAME, intervalUs }))
  return requestId
}

async function waitStatuses(requestIds, deadlineMs) {
  while (Date.now() < deadlineMs) {
    for (const requestId of requestIds) {
      const frame = statuses.get(requestId)
      if (frame?.status === 'failed') throw new Error(`${requestId}: ${frame.reason}`)
    }
    if (requestIds.every((requestId) => statuses.get(requestId)?.status === 'complete')) return
    await delay(50)
  }
  throw new Error(`transaction timeout: ${requestIds.join(', ')}`)
}

async function waitForTargets(deadlineMs) {
  while (Date.now() < deadlineMs) {
    if (targets.every((target) => target.timestamps.length > 0)) return
    await delay(100)
  }
  throw new Error('did not observe ATTITUDE from both explicit targets')
}

async function restore() {
  if (socket?.readyState !== WebSocket.OPEN) return
  const ids = targets.map((target) => sendInterval(target, 0, 'restore'))
  await waitStatuses(ids, Date.now() + 15_000)
  console.log('cleanup: restored ATTITUDE intervals to autopilot defaults for 1:1 and 2:1')
}

async function run() {
  socket = await connect(Date.now() + 120_000)
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data.toString())
    if (frame.type === 'messageInterval') statuses.set(frame.requestId, frame)
    if (frame.messageName !== MESSAGE_NAME) return
    const target = targets.find((candidate) => candidate.sysId === frame.sysId && candidate.compId === frame.compId)
    if (target !== undefined) target.timestamps.push(performance.now())
  })
  await waitForTargets(Date.now() + 120_000)
  targets.forEach((target) => { target.timestamps.length = 0 })
  const ids = targets.map((target) => sendInterval(target, target.intervalUs, 'set'))
  await waitStatuses(ids, Date.now() + 15_000)
  // Drop the command/stream scheduler settling samples after both ACKs.
  targets.forEach((target) => { target.timestamps.length = 0 })
  const sampleDeadline = Date.now() + 60_000
  while (!stopping && Date.now() < sampleDeadline && targets.some((target) => target.timestamps.length < SAMPLE_COUNT)) await delay(50)
  if (stopping) throw new Error('stopped by signal')
  if (targets.some((target) => target.timestamps.length < SAMPLE_COUNT)) throw new Error('cadence sample timeout')
  for (const target of targets) {
    const sample = target.timestamps.slice(0, SAMPLE_COUNT)
    const result = assertCadence(sample, target.intervalUs / 1000)
    console.log(`${target.name} ${target.sysId}:${target.compId}: median=${result.medianMs.toFixed(1)}ms, max=${result.maximumMs.toFixed(1)}ms, passing=${(result.passingFraction * 100).toFixed(0)}%`)
  }
  console.log('message-interval SITL acceptance passed for both explicit targets')
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true })
try {
  await run()
} finally {
  try { await restore() } catch (error) { console.error(`cleanup failed: ${error.message}`); process.exitCode = 1 }
  socket?.close()
}
