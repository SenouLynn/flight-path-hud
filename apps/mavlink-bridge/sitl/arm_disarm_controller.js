#!/usr/bin/env node
const WS_URL = process.env.BRIDGE_WS_URL ?? 'ws://bridge:8080/telemetry'
const targets = [{ name: 'copter', sysId: 1, compId: 1 }, { name: 'plane', sysId: 2, compId: 1 }]
const states = new Map(), transactions = new Map(), positions = new Set(), heartbeatCounts = new Map()
const armAttempted = new Set()
let socket = null, sequence = 0, stopping = false
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const key = (target) => `${target.sysId}:${target.compId}`
const nextId = (target, label) => `${target.name}-${label}-${++sequence}-${Date.now()}`

async function connect(deadline) {
  while (Date.now() < deadline) {
    try {
      const ws = new WebSocket(WS_URL)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect timeout')), 3000)
        ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connect failed')) }, { once: true })
      })
      return ws
    } catch { await delay(1000) }
  }
  throw new Error('bridge unavailable')
}

async function waitState(target, armed, deadline, label) {
  while (Date.now() < deadline) {
    const state = states.get(key(target))
    if (state?.armed === armed) return state
    await delay(25)
  }
  throw new Error(`${target.name}: HEARTBEAT ${label} timeout`)
}

async function setArmed(target, arm, label) {
  if (arm) armAttempted.add(key(target))
  const requestId = nextId(target, label)
  socket.send(JSON.stringify({ type: 'setArmed', requestId, sysId: target.sysId, compId: target.compId,
    arm, actor: 'sitl-arm-disarm-controller', timestampMs: Date.now(), confirmation: true,
    safetyCase: 'sitl-no-propulsion' }))
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const frame = transactions.get(requestId)
    if (frame?.status === 'failed') throw new Error(`${requestId}: ${frame.reason}`)
    if (frame?.status === 'complete') return frame
    await delay(25)
  }
  throw new Error(`${requestId}: transaction timeout`)
}

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    const ready = targets.every((target) => {
      const targetKey = key(target), state = states.get(targetKey)
      return state !== undefined && !state.armed && (state.systemStatus === 3 || state.systemStatus === 4)
        && positions.has(targetKey) && (heartbeatCounts.get(targetKey) ?? 0) >= 5
    })
    if (ready) {
      // Position and HEARTBEAT can precede final EKF/pre-arm readiness. Preserve
      // zero command retries by waiting once before the first arm attempt.
      await delay(10000)
      return
    }
    await delay(100)
  }
  throw new Error('vehicles did not reach stable disarmed readiness')
}

async function cleanup() {
  if (socket?.readyState !== WebSocket.OPEN) return
  for (const target of targets) {
    try {
      // Let any in-flight standard arm command settle before deciding whether a
      // compensating standard disarm is required. Force-disarm is never used.
      if (armAttempted.has(key(target))) await delay(1000)
      if (states.get(key(target))?.armed === true) await setArmed(target, false, 'cleanup')
      await waitState(target, false, Date.now() + 10000, 'cleanup disarm')
      console.log(`${target.name}: cleanup verified disarmed`)
    } catch (error) {
      console.error(`cleanup ${target.name} failed: ${error.message}`)
      process.exitCode = 1
    }
  }
}

async function run() {
  socket = await connect(Date.now() + 120000)
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data.toString())
    const targetKey = `${frame.sysId}:${frame.compId}`
    if (frame.type === 'flightState') {
      states.set(targetKey, frame)
      heartbeatCounts.set(targetKey, (heartbeatCounts.get(targetKey) ?? 0) + 1)
    }
    if (frame.type === 'armDisarm') transactions.set(frame.requestId, frame)
    if (frame.messageName === 'GLOBAL_POSITION_INT') positions.add(targetKey)
  })
  await waitReady(Date.now() + 120000)

  for (const target of targets) {
    const peer = targets.find((candidate) => candidate !== target)
    await setArmed(target, true, 'test-arm')
    await waitState(target, true, Date.now() + 5000, 'armed')
    if (states.get(key(peer))?.armed !== false) throw new Error(`${peer.name}: peer did not remain disarmed`)
    console.log(`${target.name} ${key(target)}: armed; ${peer.name} remained disarmed`)
    await setArmed(target, false, 'test-disarm')
    await waitState(target, false, Date.now() + 5000, 'disarmed')
    console.log(`${target.name} ${key(target)}: immediately disarmed and verified`)
  }
  console.log('arm-disarm SITL acceptance passed for both explicit targets')
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true })
try { await run() } finally { stopping = true; await cleanup(); socket?.close() }
