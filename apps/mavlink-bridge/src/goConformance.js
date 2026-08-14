import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createBridgeCore } from './bridgeCore.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const defaultSchedule = path.join(repositoryRoot, 'contracts/semantics/bridge-core-schedule.json')

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function requireTimestamp(step) {
  if (!Number.isFinite(step.atMs)) {
    throw new Error(`${step.kind ?? 'unknown'} step requires explicit finite atMs`)
  }
}

export function runCoreSchedule(schedule) {
  if (!Array.isArray(schedule?.steps)) throw new Error('schedule.steps must be an array')
  const core = createBridgeCore({
    systemTtlMs: schedule.systemTtlMs,
    now: () => { throw new Error('parity harness attempted wall-clock fallback') },
  })
  const events = []

  schedule.steps.forEach((step) => {
    requireTimestamp(step)
    if (step.kind === 'ingest') {
      if (step.envelope === null || typeof step.envelope !== 'object') {
        throw new Error('ingest step requires envelope')
      }
      const data = Buffer.from(JSON.stringify(step.envelope))
      const envelopes = core.ingestDatagram(data, step.atMs, step.source)
      events.push({ kind: 'ingest', atMs: step.atMs, envelopes })
      const conflicts = core.takeSourceConflicts()
      if (conflicts.length > 0) events.push({ kind: 'conflicts', atMs: step.atMs, conflicts })
      return
    }
    if (step.kind === 'tick') {
      core.tick(step.atMs)
      events.push({ kind: 'tick', atMs: step.atMs, systemCount: core.systemCount() })
      return
    }
    throw new Error(`unsupported schedule step: ${step.kind}`)
  })

  return canonicalize({ events })
}

export function readCoreSchedule(filePath = defaultSchedule) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function main() {
  const schedulePath = process.argv[2] === undefined ? defaultSchedule : path.resolve(process.argv[2])
  process.stdout.write(`${JSON.stringify(runCoreSchedule(readCoreSchedule(schedulePath)))}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
