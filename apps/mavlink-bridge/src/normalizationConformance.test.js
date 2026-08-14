import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { computeFrameCrc, parseIncomingDatagram } from './normalize.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const vectors = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'contracts/mavlink/normalization-frame-vectors.json'),
  'utf8',
))
const definitions = new Map(vectors.messages.map((definition) => [definition.messageId, definition]))

function buildFrame(version, messageId, payloadLength, {
  corruptCrc = false, signed = false, payload = Buffer.alloc(payloadLength),
} = {}) {
  assert.equal(payload.length, payloadLength)
  const definition = definitions.get(messageId)

  if (version === 1) {
    const frame = Buffer.alloc(6 + payloadLength + 2)
    frame[0] = 0xFE
    frame[1] = payloadLength
    frame[2] = 7
    frame[3] = 1
    frame[4] = 1
    frame[5] = messageId
    payload.copy(frame, 6)
    const crc = definition === undefined ? 0 : computeFrameCrc(frame, 1, 6 + payloadLength, definition.crcExtra)
    frame.writeUInt16LE(corruptCrc ? crc ^ 0xFFFF : crc, 6 + payloadLength)
    return frame
  }

  const signatureLength = signed ? 13 : 0
  const frame = Buffer.alloc(10 + payloadLength + 2 + signatureLength)
  frame[0] = 0xFD
  frame[1] = payloadLength
  frame[2] = signed ? 1 : 0
  frame[4] = 7
  frame[5] = 1
  frame[6] = 1
  frame[7] = messageId & 0xFF
  frame[8] = (messageId >> 8) & 0xFF
  frame[9] = (messageId >> 16) & 0xFF
  payload.copy(frame, 10)
  const crc = definition === undefined ? 0 : computeFrameCrc(frame, 1, 10 + payloadLength, definition.crcExtra)
  frame.writeUInt16LE(corruptCrc ? crc ^ 0xFFFF : crc, 10 + payloadLength)
  if (signed) frame.fill(0xA5, 12 + payloadLength)
  return frame
}

function resolveLength(expression, definition) {
  if (Number.isInteger(expression)) return expression
  if (expression === 'minLength') return definition.minLength
  if (expression === 'minLength-1') return definition.minLength - 1
  if (expression === 'minLength+1') return definition.minLength + 1
  if (expression === 'maxLength') return definition.maxLength
  if (expression === 'maxLength+1') return definition.maxLength + 1
  throw new Error(`unknown fixture length expression: ${expression}`)
}

test('all 15 common-dialect definitions obey every declared v1/v2 boundary case', () => {
  assert.equal(vectors.messages.length, 15)

  for (const definition of vectors.messages) {
    for (const boundary of vectors.requiredBoundaryCases) {
      const payloadLength = resolveLength(boundary.length, definition)
      const frame = buildFrame(boundary.version, definition.messageId, payloadLength)
      const result = parseIncomingDatagram(frame, 1234)
      const label = `${definition.messageName}:${boundary.case}`

      assert.equal(result.envelopes.length, boundary.accepted ? 1 : 0, label)
      assert.equal(result.decodeErrors, boundary.accepted ? 0 : 1, label)
      if (boundary.accepted) {
        assert.equal(result.envelopes[0].messageName, definition.messageName, label)
      }
    }
  }
})

test('all 15 independent nonzero payload vectors normalize to their expected families and fields', () => {
  assert.equal(vectors.normalizationVectors.length, 15)
  assert.equal(new Set(vectors.normalizationVectors.map((vector) => vector.messageId)).size, 15)

  for (const vector of vectors.normalizationVectors) {
    const definition = definitions.get(vector.messageId)
    assert.ok(definition, `${vector.caseId}: missing dialect definition`)
    const payload = Buffer.from(vector.payloadHex, 'hex')
    assert.equal(payload.length, definition.minLength, `${vector.caseId}: payload length`)

    const frame = buildFrame(1, vector.messageId, payload.length, { payload })
    const result = parseIncomingDatagram(frame, vectors.normalizationAtMs)
    assert.equal(result.decodeErrors, 0, vector.caseId)
    assert.equal(result.envelopes.length, 1, vector.caseId)
    assert.equal(result.envelopes[0].messageName, definition.messageName, vector.caseId)
    assert.deepEqual(result.envelopes[0].payload, vector.expectedPayload, vector.caseId)
  }
})

test('dialect-derived malformed framing cases have deterministic accounting', () => {
  for (const fixture of vectors.malformedCases) {
    let datagram
    if (fixture.kind === 'literal') {
      datagram = Buffer.from(fixture.hex, 'hex')
    } else {
      const frame = buildFrame(fixture.version, fixture.messageId, fixture.payloadLength, fixture)
      datagram = fixture.kind === 'noise-before-supported'
        ? Buffer.concat([Buffer.from([1, 2, 3]), frame])
        : frame
    }

    const result = parseIncomingDatagram(datagram, 1234)
    assert.equal(result.envelopes.length, fixture.expectedEnvelopes, fixture.caseId)
    assert.equal(result.decodeErrors, fixture.expectedDecodeErrors, fixture.caseId)
  }
})
