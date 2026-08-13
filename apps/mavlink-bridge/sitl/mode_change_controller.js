#!/usr/bin/env node
const WS_URL = process.env.BRIDGE_WS_URL ?? 'ws://bridge:8080/telemetry'
const targets = [
  { name: 'copter', sysId: 1, compId: 1, originalMode: 'STABILIZE', originalCustomMode: 0 },
  { name: 'plane', sysId: 2, compId: 1, originalMode: 'MANUAL', originalCustomMode: 0 },
]
const states = new Map(), transactions = new Map()
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

async function waitState(target, predicate, deadline, label) {
  while (Date.now() < deadline) {
    const state = states.get(key(target))
    if (state !== undefined && predicate(state)) return state
    await delay(50)
  }
  throw new Error(`${target.name}: HEARTBEAT state timeout (${label})`)
}

async function setMode(target, mode, label) {
  const requestId = nextId(target, label)
  socket.send(JSON.stringify({ type: 'setMode', requestId, sysId: target.sysId, compId: target.compId,
    mode, actor: 'sitl-mode-change-controller', timestampMs: Date.now(), confirmation: true }))
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const frame = transactions.get(requestId)
    if (frame?.status === 'failed') throw new Error(`${requestId}: ${frame.reason}`)
    if (frame?.status === 'complete') return frame
    await delay(50)
  }
  throw new Error(`${requestId}: mode transaction timeout`)
}

async function restore() {
  if (socket?.readyState !== WebSocket.OPEN) return
  for (const target of targets) {
    try {
      const state = states.get(key(target))
      if (state?.armed) throw new Error('vehicle unexpectedly armed; refusing cleanup mode command')
      if (state?.customMode !== target.originalCustomMode) await setMode(target, target.originalMode, 'cleanup')
      await waitState(target, (next) => !next.armed && next.customMode === target.originalCustomMode,
        Date.now() + 10000, 'cleanup')
      console.log(`${target.name}: restored ${target.originalMode} (${target.originalCustomMode})`)
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
    if (frame.type === 'flightState') states.set(`${frame.sysId}:${frame.compId}`, frame)
    if (frame.type === 'modeChange') transactions.set(frame.requestId, frame)
  })
  for (const target of targets) {
    await waitState(target, (state) => !state.armed && state.customMode === target.originalCustomMode,
      Date.now() + 120000, `initial ${target.originalMode}`)
  }

  for (const target of targets) {
    const peer = targets.find((candidate) => candidate !== target)
    await setMode(target, 'LOITER', 'test')
    await waitState(target, (state) => !state.armed && state.customMode !== target.originalCustomMode,
      Date.now() + 10000, 'LOITER')
    const peerState = states.get(key(peer))
    if (peerState?.armed || peerState?.customMode !== peer.originalCustomMode) throw new Error(`${peer.name}: mode changed during peer command`)
    console.log(`${target.name} ${key(target)}: entered LOITER; ${peer.name} unchanged and disarmed`)
    await setMode(target, target.originalMode, 'restore')
    await waitState(target, (state) => !state.armed && state.customMode === target.originalCustomMode,
      Date.now() + 10000, target.originalMode)
  }
  console.log('mode-change SITL acceptance passed for both explicit targets')
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true })
try { await run() } finally { stopping = true; await restore(); socket?.close() }
