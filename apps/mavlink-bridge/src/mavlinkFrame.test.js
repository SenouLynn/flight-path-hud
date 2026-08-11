import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMavlinkV1Frame, computeFrameCrc, crcAccumulate } from './mavlinkFrame.js'

test('CRC matches the published CRC-16/MCRF4XX check vector', () => {
  let crc = 0xFFFF
  for (const byte of Buffer.from('123456789')) {
    crc = crcAccumulate(byte, crc)
  }
  assert.equal(crc, 0x6F91)
})

test('buildMavlinkV1Frame produces a frame whose CRC matches computeFrameCrc', () => {
  const payload = Buffer.from([1, 2, 3, 4])
  const frame = buildMavlinkV1Frame(43, payload, { sequence: 7, sysId: 255, compId: 190, crcExtra: 132 })

  assert.equal(frame.length, 6 + payload.length + 2)
  assert.equal(frame[0], 0xFE)
  assert.equal(frame[1], payload.length)
  assert.equal(frame[2], 7)
  assert.equal(frame[3], 255)
  assert.equal(frame[4], 190)
  assert.equal(frame[5], 43)
  assert.deepEqual(frame.subarray(6, 10), payload)

  const expectedCrc = computeFrameCrc(frame, 1, 6 + payload.length, 132)
  assert.equal(frame.readUInt16LE(10), expectedCrc)
})

test('sequence wraps into a uint8', () => {
  const frame = buildMavlinkV1Frame(43, Buffer.alloc(2), { sequence: 300, sysId: 1, compId: 1, crcExtra: 132 })
  assert.equal(frame[2], 300 % 256)
})
