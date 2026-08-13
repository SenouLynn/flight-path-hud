import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { encodeGuidedReposition } from './guidedRepositionProtocol.js'

const vectors = JSON.parse(readFileSync(
  new URL('../../../contracts/mavlink/guided-reposition-vectors.json', import.meta.url),
  'utf8',
))

for (const vector of vectors) {
  test(`guided reposition matches portable bytes: ${vector.name}`, () => {
    const frame = encodeGuidedReposition(vector.input)
    const payload = frame.subarray(6, -2)
    assert.equal(payload.toString('hex'), vector.expectedPayloadHex)
    assert.equal(frame[5], vector.expected.messageId)
    assert.equal(payload.readInt32LE(16), vector.expected.latitudeDegE7)
    assert.equal(payload.readInt32LE(20), vector.expected.longitudeDegE7)
    assert.equal(payload.readFloatLE(24), vector.expected.relativeAltitudeM)
    assert.equal(payload.readUInt16LE(28), vector.expected.command)
    assert.equal(payload[32], vector.expected.coordinateFrame)
  })
}
