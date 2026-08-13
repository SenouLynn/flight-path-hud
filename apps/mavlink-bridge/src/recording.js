import fs from 'node:fs'
import path from 'node:path'

/**
 * RecordingPort: append raw datagrams as JSONL so a session replays byte-for-byte
 * through the same decoder. Recording the wire bytes rather than decoded envelopes
 * means a replay also exercises the parser, so decoder regressions show up.
 *
 * `tMs` is relative (replay pacing); `atMs` is absolute (deterministic decode).
 */
export function createJsonlRecorder(filePath, { now = Date.now, maxBytes = Infinity } = {}) {
  const stream = fs.createWriteStream(filePath, { flags: 'w' })
  const startedAtMs = now()
  let bytesWritten = 0
  let stopped = false

  return {
    record(rawBuffer) {
      if (stopped) {
        return
      }

      const atMs = now()
      const line = `${JSON.stringify({
        tMs: atMs - startedAtMs,
        atMs,
        base64: Buffer.from(rawBuffer).toString('base64'),
      })}\n`

      // Stop rather than roll over: a recording truncated in the middle is worse
      // than one that plainly ends, and silently filling a disk is worse than both.
      if (bytesWritten + line.length > maxBytes) {
        stopped = true
        console.warn(`[mavlink-bridge] recording hit its ${Math.round(maxBytes / 1e6)} MB cap; no longer recording to ${filePath}`)
        return
      }

      bytesWritten += line.length
      stream.write(line)
    },

    recordEvent(event) {
      if (stopped) return
      const atMs = now()
      const line = `${JSON.stringify({ tMs: atMs - startedAtMs, atMs, event })}\n`
      if (bytesWritten + line.length > maxBytes) {
        stopped = true
        console.warn(`[mavlink-bridge] recording hit its ${Math.round(maxBytes / 1e6)} MB cap; no longer recording to ${filePath}`)
        return
      }
      bytesWritten += line.length
      stream.write(line)
    },

    bytesWritten: () => bytesWritten,
    isStopped: () => stopped,

    close() {
      return new Promise((resolve) => {
        stream.end(resolve)
      })
    },
  }
}

/**
 * Startup housekeeping for the recordings directory.
 *
 * Recordings are the one thing here that outlives the process, so nothing else
 * reclaims them. Drops files past `maxAgeMs`, then oldest-first until the
 * directory fits `maxTotalBytes`. `excludePath` protects the file this run is
 * about to write.
 *
 * Returns what it removed so the caller can say so out loud — silent deletion of
 * someone's flight data would be worse than the disk usage.
 */
export function pruneRecordings(directory, {
  maxAgeMs = Infinity,
  maxTotalBytes = Infinity,
  excludePath = null,
  now = Date.now,
} = {}) {
  if (!fs.existsSync(directory)) {
    return { removed: [], keptBytes: 0 }
  }

  const excluded = excludePath === null ? null : path.resolve(excludePath)

  const files = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(directory, name)
      const stats = fs.statSync(fullPath)
      return { name, fullPath, sizeBytes: stats.size, modifiedMs: stats.mtimeMs }
    })
    .filter((file) => path.resolve(file.fullPath) !== excluded)
    // Newest first: age out the tail, then trim the tail again for size.
    .sort((left, right) => right.modifiedMs - left.modifiedMs)

  const removed = []
  let keptBytes = 0
  const cutoffMs = now() - maxAgeMs

  for (const file of files) {
    const tooOld = file.modifiedMs < cutoffMs
    const wouldOverflow = keptBytes + file.sizeBytes > maxTotalBytes

    if (tooOld || wouldOverflow) {
      fs.unlinkSync(file.fullPath)
      removed.push({ name: file.name, sizeBytes: file.sizeBytes, reason: tooOld ? 'age' : 'size' })
      continue
    }

    keptBytes += file.sizeBytes
  }

  return { removed, keptBytes }
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
        data: typeof entry.base64 === 'string' ? Buffer.from(entry.base64, 'base64') : null,
        event: entry.event ?? null,
      }
    })
}
