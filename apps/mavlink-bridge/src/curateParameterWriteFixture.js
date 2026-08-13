import fs from 'node:fs'
import path from 'node:path'

const [sourcePath, destinationPath] = process.argv.slice(2)
if (!sourcePath || !destinationPath) {
  console.error('usage: node curateParameterWriteFixture.js SOURCE.jsonl DESTINATION.jsonl')
  process.exit(2)
}

const events = fs.readFileSync(sourcePath, 'utf8').split('\n').filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.event?.type === 'parameterRead' || entry.event?.type === 'parameterWrite')

if (!events.some((entry) => entry.event.type === 'parameterWrite' && entry.event.status === 'complete')) {
  throw new Error('source does not contain a completed parameter write')
}

const requestIds = new Map()
let nextRequest = 1
const baseMs = 1_800_000_000_000
const curated = events.map((entry, index) => {
  const originalId = entry.event.requestId
  if (!requestIds.has(originalId)) requestIds.set(originalId, `request-${String(nextRequest++).padStart(2, '0')}`)
  const atMs = baseMs + index * 10
  const event = { ...entry.event, requestId: requestIds.get(originalId), updatedAtMs: atMs }
  if (event.requestedAtMs !== undefined) event.requestedAtMs = atMs
  return JSON.stringify({ tMs: index * 10, atMs, event })
})

fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
fs.writeFileSync(destinationPath, `${curated.join('\n')}\n`)
console.log(`curated ${curated.length} parameter lifecycle events to ${destinationPath}`)
