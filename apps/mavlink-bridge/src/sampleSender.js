import dgram from 'node:dgram'

const UDP_HOST = process.env.MAVLINK_BRIDGE_UDP_HOST ?? '127.0.0.1'
const UDP_PORT = Number.parseInt(process.env.MAVLINK_BRIDGE_UDP_PORT ?? '14550', 10)

const socket = dgram.createSocket('udp4')

let sequence = 0

function send(messageName, payload) {
  sequence += 1
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
  const headingDeg = (180 + Math.sin(t * 0.35) * 45 + 360) % 360
  const rollRad = 0.45 * Math.cos(t * 0.35)
  const pitchRad = 0.12 * Math.sin(t * 0.5)
  const groundSpeedMps = 18 + Math.sin(t * 0.2)
  const climbMps = Math.sin(t * 0.4)

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
      headingCdeg: headingDeg * 100,
      vxCms: groundSpeedMps * 100,
      vyCms: 0,
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
