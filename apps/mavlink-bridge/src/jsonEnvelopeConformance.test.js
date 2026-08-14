import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseIncomingDatagram } from './normalize.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const validEnvelopes = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'contracts/fixtures/valid/normalized-envelopes.json'), 'utf8',
))
const invalidFixtures = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'contracts/fixtures/invalid/normalized-envelope-cases.json'), 'utf8',
))

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function envelope(messageName = 'HEARTBEAT') {
  const found = validEnvelopes.find((candidate) => candidate.messageName === messageName)
  assert.ok(found, `missing valid fixture for ${messageName}`)
  return clone(found)
}

function parseJson(value, atMs = 999) {
  return parseIncomingDatagram(Buffer.from(JSON.stringify(value)), atMs)
}

test('strict JSON ingress consumes all 15 language-neutral normalized-envelope fixtures', () => {
  assert.equal(validEnvelopes.length, 15)
  for (const candidate of validEnvelopes) {
    const result = parseJson(candidate)
    assert.equal(result.decodeErrors, 0, candidate.messageName)
    assert.deepEqual(result.envelopes, [candidate], candidate.messageName)
  }
})

test('strict JSON ingress preserves zero identifiers, zero sequence, and sender timestamps', () => {
  const candidate = envelope()
  Object.assign(candidate, { recvTimestampMs: 10, sysId: 0, compId: 0, sequence: 0 })
  candidate.payload.timestampMs = 9
  const result = parseJson(candidate, 123456)
  assert.deepEqual(result.envelopes[0], candidate)
})

test('strict JSON ingress rejects the language-neutral invalid normalized-envelope fixtures', () => {
  for (const fixture of invalidFixtures) {
    assert.deepEqual(
      parseJson(fixture.frame),
      { envelopes: [], decodeErrors: 1 },
      fixture.caseId,
    )
  }
})

test('strict JSON ingress rejects missing, prototype-named, ill-typed, and out-of-range values', () => {
  const cases = []
  const add = (label, mutate) => {
    const candidate = envelope()
    mutate(candidate)
    cases.push([label, candidate])
  }

  add('missing envelope key', (value) => { delete value.compId })
  add('non-finite receive timestamp', (value) => { value.recvTimestampMs = null })
  add('negative system id', (value) => { value.sysId = -1 })
  add('oversized component id', (value) => { value.compId = 256 })
  add('fractional sequence', (value) => { value.sequence = 1.5 })
  add('prototype message name', (value) => { value.messageName = 'toString' })
  add('missing section field', (value) => { delete value.payload.heartbeat.armed })
  add('wrong section type', (value) => { value.payload.heartbeat.armed = 0 })
  add('out-of-range section integer', (value) => { value.payload.heartbeat.baseMode = 256 })

  for (const [label, candidate] of cases) {
    assert.deepEqual(parseJson(candidate), { envelopes: [], decodeErrors: 1 }, label)
  }
})
