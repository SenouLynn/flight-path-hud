import dgram from 'node:dgram'
import { decodeMissionRequest } from './encode.js'
import { encodeMissionCount, encodeMissionItemInt } from './normalize.js'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '127.0.0.1'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)
// Fixed source port, used as a single-instance lock (see socket.bind below).
const LOCK_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_SAMPLE_PORT ?? '14549', 10)

const socket = dgram.createSocket('udp4')

// Mirrors logic/position.ts and the web mock so the dead-reckoned and absolute
// GPS paths agree. Arbitrary launch point (Zürich-ish) at 500 m MSL.
const METERS_PER_DEG_LAT = 111319.49
const DEG_E7 = 1e7
const ORIGIN = { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 }
const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos((ORIGIN.latDegE7 / DEG_E7) * Math.PI / 180)

// A fixed 3-waypoint mission near ORIGIN, offset a few hundred metres each way so
// it's visually distinct from the flight path on the map.
const MOCK_MISSION = [
  { seq: 0, command: 16, current: true, autocontinue: true, frameId: 3, latDegE7: ORIGIN.latDegE7 + 2000, lonDegE7: ORIGIN.lonDegE7 + 2000, altM: 80 },
  { seq: 1, command: 16, current: false, autocontinue: true, frameId: 3, latDegE7: ORIGIN.latDegE7 + 4000, lonDegE7: ORIGIN.lonDegE7 - 1000, altM: 100 },
  { seq: 2, command: 16, current: false, autocontinue: true, frameId: 3, latDegE7: ORIGIN.latDegE7 + 1000, lonDegE7: ORIGIN.lonDegE7 - 3000, altM: 60 },
]

const MOCK_VEHICLE_SYS_ID = 1
const MOCK_VEHICLE_COMP_ID = 1

/** Plays the vehicle's side of the mission handshake: decode what the bridge just
 * sent, reply with a real, CRC'd response. No state kept across calls — every
 * request gets answered from MOCK_MISSION fresh, matching how a real autopilot
 * would answer the same request twice identically. */
function handleMissionRequest(datagram, rinfo) {
  const request = decodeMissionRequest(datagram)
  if (request === null) {
    return
  }

  if (request.messageName === 'MISSION_REQUEST_LIST') {
    const frame = encodeMissionCount({ sysId: MOCK_VEHICLE_SYS_ID, compId: MOCK_VEHICLE_COMP_ID, count: MOCK_MISSION.length })
    socket.send(frame, rinfo.port, rinfo.address)
    return
  }

  if (request.messageName === 'MISSION_REQUEST_INT') {
    const item = MOCK_MISSION[request.seq]
    if (item === undefined) {
      return
    }
    const frame = encodeMissionItemInt({ sysId: MOCK_VEHICLE_SYS_ID, compId: MOCK_VEHICLE_COMP_ID, item })
    socket.send(frame, rinfo.port, rinfo.address)
  }
}

// Flight profile: a gentle S-turn cruise. Amplitude/frequency are the only knobs;
// bank is derived from the resulting turn rate below so the two stay consistent.
const GRAVITY_MPS2 = 9.81
const CRUISE_SPEED_MPS = 18
const HEADING_AMPLITUDE_DEG = 20
const TURN_FREQ_RAD_PER_SEC = 0.25

let sequence = 0
let northM = 0
let eastM = 0
let upM = 0
let lastTickMs = Date.now()

function send(messageName, payload) {
  sequence = (sequence + 1) % 256
  const body = JSON.stringify({
    recvTimestampMs: Date.now(),
    sysId: 1,
    compId: 1,
    messageName,
    sequence,
    payload,
  })

  socket.send(body, UDP_PORT, UDP_HOST)
}

function sendTick() {
  const now = Date.now()
  const t = now / 1000
  const turnPhase = t * TURN_FREQ_RAD_PER_SEC
  const headingDeg = (180 + Math.sin(turnPhase) * HEADING_AMPLITUDE_DEG + 360) % 360
  const pitchRad = 0.12 * Math.sin(t * 0.5)
  const groundSpeedMps = CRUISE_SPEED_MPS + Math.sin(t * 0.2)
  const climbMps = Math.sin(t * 0.4)

  // Bank the aircraft the way a coordinated turn actually would: tan(phi) = V*psi_dot/g.
  // Derived rather than hand-tuned so the HUD's slip/skid readout and its
  // g*tan(phi)/V turn-rate fallback agree with the heading the craft is flying.
  const headingRateRadPerSec = ((HEADING_AMPLITUDE_DEG * Math.PI) / 180)
    * TURN_FREQ_RAD_PER_SEC * Math.cos(turnPhase)
  const rollRad = Math.atan((headingRateRadPerSec * groundSpeedMps) / GRAVITY_MPS2)

  // Velocities are NED earth-frame: project ground speed onto the heading so the
  // track actually follows the turn instead of running due north forever.
  const headingRad = (headingDeg * Math.PI) / 180
  const vNorthMps = groundSpeedMps * Math.cos(headingRad)
  const vEastMps = groundSpeedMps * Math.sin(headingRad)

  const dtSec = Math.min((now - lastTickMs) / 1000, 5)
  lastTickMs = now
  northM += vNorthMps * dtSec
  eastM += vEastMps * dtSec
  upM += climbMps * dtSec

  send('HEARTBEAT', {
    timestampMs: now,
  })

  send('ATTITUDE', {
    timestampMs: now,
    attitude: {
      rollRad,
      pitchRad,
      yawRad: (headingDeg - 180) * Math.PI / 180,
    },
  })

  send('VFR_HUD', {
    timestampMs: now,
    vfrHud: {
      headingDeg,
      airSpeedMps: groundSpeedMps,
      groundSpeedMps,
      climbMps,
    },
  })

  send('GLOBAL_POSITION_INT', {
    timestampMs: now,
    globalPositionInt: {
      latDegE7: Math.round(ORIGIN.latDegE7 + (northM / METERS_PER_DEG_LAT) * DEG_E7),
      lonDegE7: Math.round(ORIGIN.lonDegE7 + (eastM / METERS_PER_DEG_LON) * DEG_E7),
      altMm: Math.round(ORIGIN.altMm + upM * 1000),
      relativeAltMm: Math.round(upM * 1000),
      headingCdeg: headingDeg * 100,
      vxCms: vNorthMps * 100,
      vyCms: vEastMps * 100,
      vzCms: -climbMps * 100,
    },
  })

  send('GPS_RAW_INT', {
    timestampMs: now,
    gpsRawInt: {
      cogCdeg: headingDeg * 100,
      velCms: groundSpeedMps * 100,
    },
  })
}

let timer = null

// Binding a fixed source port doubles as a single-instance lock. Two senders both
// claim sysId 1, so the client merges them into one aircraft flying two tracks at
// once — a sawtooth that looks like a rendering bug. Fail loudly instead.
socket.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[mavlink-bridge sample] a sample sender is already running (lock port ${LOCK_PORT} is taken).`)
    console.error('[mavlink-bridge sample] Two senders would merge into one contradictory vehicle. Refusing to start.')
    console.error('[mavlink-bridge sample] Stop the other one first:  pkill -f sampleSender.js')
  } else {
    console.error(`[mavlink-bridge sample] socket error: ${err.message}`)
  }

  process.exit(1)
})

socket.on('message', (datagram, rinfo) => {
  handleMissionRequest(datagram, rinfo)
})

socket.bind(LOCK_PORT, () => {
  console.log(`[mavlink-bridge sample] sending UDP envelopes to ${UDP_HOST}:${UDP_PORT} (from :${LOCK_PORT})`)
  timer = setInterval(sendTick, 150)
})

process.on('SIGINT', () => {
  if (timer !== null) {
    clearInterval(timer)
  }
  socket.close()
  process.exit(0)
})
