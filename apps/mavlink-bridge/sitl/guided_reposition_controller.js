#!/usr/bin/env node
const WS_URL = process.env.BRIDGE_WS_URL ?? 'ws://bridge:8080/telemetry'
const targets = [
  { name: 'copter', sysId: 1, compId: 1, guidedMode: 4, offsetNorthM: 30,
    arrivalRadiusM: 8, altitudeToleranceM: 5 },
  { name: 'plane', sysId: 2, compId: 1, guidedMode: 15, offsetNorthM: 250,
    arrivalRadiusM: 100, altitudeToleranceM: 15, loiterRadiusM: 75, loiterDirection: 'clockwise' },
]
const states = new Map(), positions = new Map(), transactions = new Map()
let socket = null, sequence = 0
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const key = (target) => `${target.sysId}:${target.compId}`
const radians = (degrees) => degrees * Math.PI / 180
const distanceM = (a, b) => {
  const lat1 = radians(a.latitudeDeg), lat2 = radians(b.latitudeDeg)
  const dlat = lat2 - lat1, dlon = radians(b.longitudeDeg - a.longitudeDeg)
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

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

async function waitReady(target, deadline) {
  while (Date.now() < deadline) {
    const state = states.get(key(target)), position = positions.get(key(target))
    if (state?.armed && state.customMode === target.guidedMode && position?.relativeAltitudeM >= 10) return position
    await delay(100)
  }
  throw new Error(`${target.name}: airborne Guided readiness timeout`)
}

async function reposition(target, initial) {
  const latitudeDeg = initial.latitudeDeg + target.offsetNorthM / 111_111
  const longitudeDeg = initial.longitudeDeg
  const requestId = `${target.name}-guided-${++sequence}-${Date.now()}`
  const marginDeg = 0.01
  const safetyEnvelope = { minLatitudeDeg: Math.min(initial.latitudeDeg, latitudeDeg) - marginDeg,
    maxLatitudeDeg: Math.max(initial.latitudeDeg, latitudeDeg) + marginDeg,
    minLongitudeDeg: longitudeDeg - marginDeg, maxLongitudeDeg: longitudeDeg + marginDeg,
    minRelativeAltitudeM: Math.max(1, initial.relativeAltitudeM - 20),
    maxRelativeAltitudeM: initial.relativeAltitudeM + 20,
    maxArrivalRadiusM: 120, maxAltitudeToleranceM: 20,
    ...(target.loiterRadiusM ? { maxLoiterRadiusM: 100 } : {}) }
  socket.send(JSON.stringify({ type: 'guidedReposition', requestId, sysId: target.sysId,
    compId: target.compId, latitudeDeg, longitudeDeg,
    relativeAltitudeM: initial.relativeAltitudeM, arrivalRadiusM: target.arrivalRadiusM,
    altitudeToleranceM: target.altitudeToleranceM, loiterRadiusM: target.loiterRadiusM,
    loiterDirection: target.loiterDirection, actor: 'sitl-guided-reposition-controller',
    timestampMs: Date.now(), confirmation: true, safetyCase: 'isolated-sitl-guided', safetyEnvelope }))
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    const frame = transactions.get(requestId)
    if (frame?.status === 'failed') throw new Error(`${requestId}: ${frame.reason}`)
    if (frame?.status === 'complete') {
      const final = positions.get(key(target))
      const displacement = distanceM(initial, final)
      if (displacement < target.offsetNorthM - target.arrivalRadiusM - 5) {
        throw new Error(`${target.name}: insufficient displacement ${displacement.toFixed(1)}m`)
      }
      console.log(`${target.name} ${key(target)}: Guided reposition complete; displacement=${displacement.toFixed(1)}m`)
      return
    }
    await delay(50)
  }
  throw new Error(`${requestId}: transaction timeout`)
}

async function run() {
  socket = await connect(Date.now() + 180000)
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(event.data.toString()), targetKey = `${frame.sysId}:${frame.compId}`
    if (frame.type === 'flightState') states.set(targetKey, frame)
    if (frame.type === 'guidedReposition') transactions.set(frame.requestId, frame)
    if (frame.messageName === 'GLOBAL_POSITION_INT') {
      const p = frame.payload.globalPositionInt
      positions.set(targetKey, { latitudeDeg: p.latDegE7 / 1e7,
        longitudeDeg: p.lonDegE7 / 1e7, relativeAltitudeM: p.relativeAltMm / 1000 })
    }
  })
  const initialPositions = new Map()
  for (const target of targets) {
    initialPositions.set(key(target), await waitReady(target, Date.now() + 180000))
  }
  for (const target of targets) {
    const initial = initialPositions.get(key(target))
    const peer = targets.find((candidate) => candidate !== target)
    await reposition(target, initial)
    const peerState = states.get(key(peer))
    if (!peerState?.armed || peerState.customMode !== peer.guidedMode) throw new Error(`${peer.name}: peer state changed`)
  }
  console.log('Guided reposition SITL acceptance passed for distinct Copter and Plane semantics')
}

try { await run() } finally { socket?.close() }
