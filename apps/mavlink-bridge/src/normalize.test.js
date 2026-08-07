import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc, crcAccumulate, parseIncomingDatagram } from './normalize.js'

const CRC_EXTRA = { 0: 50, 24: 24, 30: 39, 33: 104, 74: 20 }

function buildMavlinkV1Frame(messageId, payload, { sequence = 7, sysId = 1, compId = 1, corruptCrc = false } = {}) {
  const frame = Buffer.alloc(6 + payload.length + 2)
  frame[0] = 0xFE
  frame[1] = payload.length
  frame[2] = sequence
  frame[3] = sysId
  frame[4] = compId
  frame[5] = messageId
  payload.copy(frame, 6)

  const crcExtra = CRC_EXTRA[messageId]
  const crc = crcExtra === undefined ? 0 : computeFrameCrc(frame, 1, 6 + payload.length, crcExtra)
  frame.writeUInt16LE(corruptCrc ? crc ^ 0xFFFF : crc, 6 + payload.length)

  return frame
}

test('CRC matches the published CRC-16/MCRF4XX check vector', () => {
  // Pins the checksum primitive to the spec rather than to our own frame builder.
  let crc = 0xFFFF
  for (const byte of Buffer.from('123456789')) {
    crc = crcAccumulate(byte, crc)
  }
  assert.equal(crc, 0x6F91)
})

test('rejects MAVLink frames with a bad checksum', () => {
  const payload = Buffer.alloc(28)
  payload.writeFloatLE(0.1, 4)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(30, payload, { corruptCrc: true }))
  assert.equal(result.envelopes.length, 0)
  assert.ok(result.decodeErrors >= 1)
})

test('parses JSON envelope datagrams', () => {
  const datagram = Buffer.from(JSON.stringify({
    recvTimestampMs: 10,
    sysId: 1,
    compId: 1,
    messageName: 'VFR_HUD',
    sequence: 9,
    payload: {
      timestampMs: 10,
      vfrHud: {
        headingDeg: 120,
      },
    },
  }))

  const result = parseIncomingDatagram(datagram)
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 1)
  assert.equal(result.envelopes[0].messageName, 'VFR_HUD')
})

test('wraps oversized JSON sequence numbers into uint8 range', () => {
  const datagram = Buffer.from(JSON.stringify({
    recvTimestampMs: 10,
    sysId: 1,
    compId: 1,
    messageName: 'HEARTBEAT',
    sequence: 259,
    payload: { timestampMs: 10 },
  }))

  // Consumers reject any sequence above 255, so a long-running sender must not overflow the field.
  const result = parseIncomingDatagram(datagram)
  assert.equal(result.envelopes[0].sequence, 3)
})

test('parses MAVLink v1 ATTITUDE frames', () => {
  const payload = Buffer.alloc(28)
  payload.writeUInt32LE(1234, 0)
  payload.writeFloatLE(0.1, 4)
  payload.writeFloatLE(-0.2, 8)
  payload.writeFloatLE(0.3, 12)
  payload.writeFloatLE(0.4, 16)
  payload.writeFloatLE(-0.5, 20)
  payload.writeFloatLE(0.6, 24)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(30, payload))
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 1)
  assert.equal(result.envelopes[0].messageName, 'ATTITUDE')
  assert.equal(result.envelopes[0].payload.attitude.rollRad.toFixed(3), '0.100')
  assert.equal(result.envelopes[0].payload.attitude.pitchRad.toFixed(3), '-0.200')
  assert.equal(result.envelopes[0].payload.attitude.yawSpeedRadPerSec.toFixed(3), '0.600')
})

test('parses multiple MAVLink frames from one datagram and ignores unsupported messages', () => {
  const heartbeatPayload = Buffer.alloc(9)
  const vfrPayload = Buffer.alloc(20)
  vfrPayload.writeFloatLE(22.5, 0)
  vfrPayload.writeFloatLE(20.25, 4)
  vfrPayload.writeFloatLE(120, 8)
  vfrPayload.writeFloatLE(1.75, 12)
  vfrPayload.writeInt16LE(165, 16)
  vfrPayload.writeUInt16LE(50, 18)
  const unsupportedPayload = Buffer.alloc(2)

  const datagram = Buffer.concat([
    buildMavlinkV1Frame(0, heartbeatPayload),
    buildMavlinkV1Frame(74, vfrPayload),
    buildMavlinkV1Frame(250, unsupportedPayload),
  ])

  const result = parseIncomingDatagram(datagram)
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes.length, 2)
  assert.equal(result.envelopes[0].messageName, 'HEARTBEAT')
  assert.equal(result.envelopes[1].messageName, 'VFR_HUD')
  assert.equal(result.envelopes[1].payload.vfrHud.headingDeg, 165)
  assert.equal(result.envelopes[1].payload.vfrHud.airSpeedMps.toFixed(2), '22.50')
  assert.equal(result.envelopes[1].payload.vfrHud.groundSpeedMps.toFixed(2), '20.25')
  assert.equal(result.envelopes[1].payload.vfrHud.climbMps.toFixed(2), '1.75')
})