import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createJsonlRecorder, pruneRecordings } from './recording.js'

function tempDir(name) {
  const dir = path.join(os.tmpdir(), `mavlink-retention-${process.pid}-${name}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Write a file of `sizeBytes` with a given age in days. */
function seed(dir, name, sizeBytes, ageDays) {
  const full = path.join(dir, name)
  fs.writeFileSync(full, 'x'.repeat(sizeBytes))
  const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
  fs.utimesSync(full, when, when)
  return full
}

test('prunes recordings past the age limit', () => {
  const dir = tempDir('age')
  seed(dir, 'old.jsonl', 100, 30)
  seed(dir, 'recent.jsonl', 100, 1)

  const { removed } = pruneRecordings(dir, { maxAgeMs: 7 * 24 * 60 * 60 * 1000 })

  assert.deepEqual(removed.map((r) => r.name), ['old.jsonl'])
  assert.deepEqual(fs.readdirSync(dir), ['recent.jsonl'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('trims oldest first once the directory exceeds its size budget', () => {
  const dir = tempDir('size')
  seed(dir, 'a-newest.jsonl', 500, 1)
  seed(dir, 'b-middle.jsonl', 500, 2)
  seed(dir, 'c-oldest.jsonl', 500, 3)

  const { removed, keptBytes } = pruneRecordings(dir, { maxTotalBytes: 1100 })

  assert.deepEqual(removed.map((r) => r.name), ['c-oldest.jsonl'])
  assert.equal(keptBytes, 1000)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('never deletes the recording this run is about to write', () => {
  const dir = tempDir('exclude')
  const active = seed(dir, 'active.jsonl', 5000, 99)

  const { removed } = pruneRecordings(dir, { maxAgeMs: 1000, excludePath: active })

  assert.deepEqual(removed, [])
  assert.ok(fs.existsSync(active))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('leaves non-recording files alone', () => {
  const dir = tempDir('other')
  seed(dir, 'notes.txt', 100, 99)
  seed(dir, 'old.jsonl', 100, 99)

  pruneRecordings(dir, { maxAgeMs: 1000 })

  assert.deepEqual(fs.readdirSync(dir), ['notes.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('is a no-op when the directory does not exist', () => {
  const { removed, keptBytes } = pruneRecordings('/tmp/definitely-not-here-xyz')
  assert.deepEqual(removed, [])
  assert.equal(keptBytes, 0)
})

test('a recorder stops at its byte cap instead of filling the disk', async () => {
  const dir = tempDir('cap')
  const file = path.join(dir, 'capped.jsonl')
  const recorder = createJsonlRecorder(file, { maxBytes: 400 })

  for (let i = 0; i < 200; i += 1) {
    recorder.record(Buffer.from('some telemetry payload'))
  }
  await recorder.close()

  assert.ok(recorder.isStopped(), 'expected the cap to engage')
  assert.ok(recorder.bytesWritten() <= 400, `wrote ${recorder.bytesWritten()} bytes`)
  assert.ok(fs.statSync(file).size <= 400)
  fs.rmSync(dir, { recursive: true, force: true })
})
