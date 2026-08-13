#!/usr/bin/env node
const WS_URL = process.env.BRIDGE_WS_URL ?? 'ws://bridge:8080/telemetry'
const targets = [{ name: 'copter', sysId: 1, compId: 1 }, { name: 'plane', sysId: 2, compId: 1 }]
const uploads = new Map(), missions = new Map(), seen = new Set(), originals = new Map()
let socket = null, sequence = 0, stopping = false
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const key = ({ sysId, compId }) => `${sysId}:${compId}`
const nextId = (label) => `${label}-${++sequence}-${Date.now()}`

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

async function waitUpload(requestId, deadline) {
  while (Date.now() < deadline) {
    const frame = uploads.get(requestId)
    if (frame?.status === 'failed' || frame?.status === 'rejected') throw new Error(`${requestId}: ${frame.reason}`)
    if (frame?.status === 'complete') return frame
    await delay(50)
  }
  throw new Error(`${requestId}: upload timeout`)
}

async function readMission(target, label) {
  missions.delete(key(target))
  socket.send(JSON.stringify({ type: 'requestMission', sysId: target.sysId, compId: target.compId }))
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const frame = missions.get(key(target))
    if (frame?.status === 'failed') throw new Error(`${target.name} ${label}: ${frame.reason}`)
    if (frame?.status === 'complete') return frame.items
    await delay(50)
  }
  throw new Error(`${target.name} ${label}: mission read timeout`)
}

async function upload(target, items, label) {
  const requestId = nextId(`${target.name}-${label}`)
  socket.send(JSON.stringify({ type: 'uploadMission', requestId, sysId: target.sysId, compId: target.compId,
    actor: 'sitl-mission-upload-controller', timestampMs: Date.now(), confirmation: true,
    policy: 'clearThenReplace', items }))
  await waitUpload(requestId, Date.now() + 45000)
}

const numericFields = ['param1', 'param2', 'param3', 'param4', 'altM']
const exactFields = ['seq', 'command', 'frameId', 'current', 'autocontinue']
function sameMission(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((item, index) => exactFields.every((field) => item[field] === right[index][field])
      && Math.abs(item.latDegE7 - right[index].latDegE7) <= 100
      && Math.abs(item.lonDegE7 - right[index].lonDegE7) <= 100
      && numericFields.every((field) => Math.abs(item[field] - right[index][field]) <= 1e-4))
}
function assertMission(actual, expected, label) {
  if (!sameMission(actual, expected)) throw new Error(`${label}: mission mismatch`)
}
function changedMission(original) {
  if (original.length < 2) throw new Error('test mission needs at least two items')
  return original.map((item, index) => index === 1 ? { ...item, latDegE7: item.latDegE7 + 1000 } : { ...item })
}

async function restore() {
  if (socket?.readyState !== WebSocket.OPEN) return
  for (const target of targets) {
    const original = originals.get(target.name)
    if (original === undefined) continue
    try {
      await upload(target, original, 'cleanup')
      assertMission(await readMission(target, 'cleanup'), original, `${target.name} cleanup`)
      console.log(`${target.name}: original ${original.length}-item mission restored and verified`)
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
    if (frame.type === 'missionUpload') uploads.set(frame.requestId, frame)
    if (frame.type === 'mission') missions.set(`${frame.sysId}:${frame.compId}`, frame)
    if (frame.messageName === 'HEARTBEAT') seen.add(`${frame.sysId}:${frame.compId}`)
  })
  while (!stopping && targets.some((target) => !seen.has(key(target)))) await delay(100)
  if (stopping) throw new Error('stopped by signal')

  for (const target of targets) originals.set(target.name, await readMission(target, 'original'))
  for (const target of targets) {
    const peer = targets.find((candidate) => candidate !== target)
    const replacement = changedMission(originals.get(target.name))
    await upload(target, replacement, 'test')
    assertMission(await readMission(target, 'post-upload'), replacement, `${target.name} replacement`)
    assertMission(await readMission(peer, 'isolation'), originals.get(peer.name), `${peer.name} isolation`)
    console.log(`${target.name} ${key(target)}: replaced/read ${replacement.length} items; ${peer.name} unchanged`)
    await upload(target, originals.get(target.name), 'restore')
    assertMission(await readMission(target, 'restore'), originals.get(target.name), `${target.name} restore`)
  }
  console.log('mission-upload SITL acceptance passed for both explicit targets')
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true })
try { await run() } finally { await restore(); socket?.close() }
