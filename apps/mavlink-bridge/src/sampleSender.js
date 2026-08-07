import dgram from 'node:dgram'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '127.0.0.1'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)

const socket = dgram.createSocket('udp4')

// Mirrors logic/position.ts and the web mock so the dead-reckoned and absolute
// GPS paths agree. Arbitrary launch point (Zürich-ish) at 500 m MSL.
const METERS_PER_DEG_LAT = 111319.49
const DEG_E7 = 1e7
const ORIGIN = { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 }
const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos((ORIGIN.latDegE7 / DEG_E7) * Math.PI / 180)

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

const timer = setInterval(() => {
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
}, 150)

console.log(`[mavlink-bridge sample] sending UDP envelopes to ${UDP_HOST}:${UDP_PORT}`)

process.on('SIGINT', () => {
  clearInterval(timer)
  socket.close()
  process.exit(0)
})
