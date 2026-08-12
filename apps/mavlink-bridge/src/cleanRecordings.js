/**
 * Manual sweep of the recordings directory.
 *
 * The bridge already prunes on startup (ADR-0023), but that only runs when the
 * bridge runs. This is the same policy on demand — for reclaiming space without
 * starting anything, or for wiping the directory outright.
 *
 *   npm run clean:recordings                 # apply the normal retention policy
 *   npm run clean:recordings -- --all        # delete every recording
 *   npm run clean:recordings -- --dry-run    # report only, delete nothing
 */

import fs from 'node:fs'
import path from 'node:path'
import { pruneRecordings } from './recording.js'

const RECORD_DIR = process.env.MAVLINK_BRIDGE_RECORD_DIR ?? 'recordings'
const RETAIN_DAYS = Number.parseFloat(process.env.MAVLINK_BRIDGE_RECORD_RETAIN_DAYS ?? '7')
const TOTAL_MAX_MB = Number.parseFloat(process.env.MAVLINK_BRIDGE_RECORD_TOTAL_MAX_MB ?? '128')

const args = process.argv.slice(2)
const deleteAll = args.includes('--all')
const dryRun = args.includes('--dry-run')

/*
 * Announce the mode before doing anything. Nested `npm run` swallows `--` flags,
 * and a --dry-run that silently became a real delete is exactly the failure this
 * line makes impossible to miss.
 */
console.log(`[clean] mode: ${dryRun ? 'DRY RUN (nothing will be deleted)' : deleteAll ? 'DELETE ALL' : 'retention policy'}`)

function listRecordings(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }

  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(directory, name)
      const stats = fs.statSync(fullPath)
      return { name, fullPath, sizeBytes: stats.size, modifiedMs: stats.mtimeMs }
    })
    // Match pruneRecordings(): preserve the newest captures first.
    .sort((left, right) => right.modifiedMs - left.modifiedMs)
}

const before = listRecordings(RECORD_DIR)
const beforeBytes = before.reduce((total, file) => total + file.sizeBytes, 0)

if (before.length === 0) {
  console.log(`[clean] nothing to do — no recordings in ${RECORD_DIR}`)
  process.exit(0)
}

console.log(`[clean] ${before.length} recording(s), ${(beforeBytes / 1e6).toFixed(1)} MB in ${RECORD_DIR}`)

if (dryRun) {
  // Report against the real policy without touching anything: maxAge/maxTotal of
  // zero would report a different answer than the policy actually applies.
  const cutoffMs = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000
  let kept = 0
  for (const file of before) {
    const tooOld = fs.statSync(file.fullPath).mtimeMs < cutoffMs
    const wouldOverflow = kept + file.sizeBytes > TOTAL_MAX_MB * 1e6
    const doomed = deleteAll || tooOld || wouldOverflow
    if (!doomed) {
      kept += file.sizeBytes
    }
    console.log(`  ${doomed ? 'would delete' : 'would keep  '}  ${file.name}  ${(file.sizeBytes / 1e6).toFixed(1)} MB`)
  }
  process.exit(0)
}

if (deleteAll) {
  before.forEach((file) => {
    fs.unlinkSync(file.fullPath)
    console.log(`  deleted ${file.name} (${(file.sizeBytes / 1e6).toFixed(1)} MB)`)
  })
  console.log(`[clean] removed all ${before.length} recording(s), ${(beforeBytes / 1e6).toFixed(1)} MB freed`)
  process.exit(0)
}

const { removed, keptBytes } = pruneRecordings(RECORD_DIR, {
  maxAgeMs: RETAIN_DAYS * 24 * 60 * 60 * 1000,
  maxTotalBytes: TOTAL_MAX_MB * 1e6,
})

removed.forEach(({ name, sizeBytes, reason }) => {
  console.log(`  deleted ${name} (${(sizeBytes / 1e6).toFixed(1)} MB, ${reason})`)
})

const freedBytes = beforeBytes - keptBytes
console.log(`[clean] removed ${removed.length}, kept ${(keptBytes / 1e6).toFixed(1)} MB, freed ${(freedBytes / 1e6).toFixed(1)} MB`)
