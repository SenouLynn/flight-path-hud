import fs from 'node:fs'

/**
 * RecordingPort: append raw datagrams as JSONL so a session replays byte-for-byte
 * through the same decoder. Recording the wire bytes rather than decoded envelopes
 * means a replay also exercises the parser, so decoder regressions show up.
 *
 * `tMs` is relative (replay pacing); `atMs` is absolute (deterministic decode).
 */
export function createJsonlRecorder(filePath, { now = Date.now } = {}) {
  const stream = fs.createWriteStream(filePath, { flags: 'w' })
  const startedAtMs = now()

  return {
    record(rawBuffer) {
      const atMs = now()
      stream.write(`${JSON.stringify({
        tMs: atMs - startedAtMs,
        atMs,
        base64: Buffer.from(rawBuffer).toString('base64'),
      })}\n`)
    },

    close() {
      return new Promise((resolve) => {
        stream.end(resolve)
      })
    },
  }
}

/** Read a JSONL recording back into datagrams. */
export function readRecording(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const entry = JSON.parse(line)
      return {
        tMs: entry.tMs,
        atMs: entry.atMs,
        data: Buffer.from(entry.base64, 'base64'),
      }
    })
}
