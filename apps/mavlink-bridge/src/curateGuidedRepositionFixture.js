import fs from 'node:fs'
import path from 'node:path'

const [sourcePath, destinationPath] = process.argv.slice(2)
if (!sourcePath || !destinationPath) {
  console.error('usage: node curateGuidedRepositionFixture.js SOURCE.jsonl DESTINATION.jsonl')
  process.exit(2)
}

const events = fs.readFileSync(sourcePath, 'utf8').split('\n').filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.event?.type === 'guidedReposition')
const completed = events.filter((entry) => entry.event.status === 'complete')
if (events.length !== 6 || completed.length !== 2
  || !completed.some((entry) => entry.event.sysId === 1 && entry.event.vehicleType === 2)
  || !completed.some((entry) => entry.event.sysId === 2 && entry.event.vehicleType === 1)) {
  throw new Error('source must contain one complete three-event Guided lifecycle for Copter 1:1 and Plane 2:1')
}

const requestIds = new Map(), requestTimes = new Map()
let nextRequest = 1
const baseMs = 1_800_000_400_000
const curated = events.map((entry, index) => {
  if (!requestIds.has(entry.event.requestId)) {
    requestIds.set(entry.event.requestId, `guided-reposition-${String(nextRequest++).padStart(2, '0')}`)
    requestTimes.set(entry.event.requestId, baseMs + index * 10)
  }
  const atMs = baseMs + index * 10
  const event = { ...entry.event, requestId: requestIds.get(entry.event.requestId),
    requestedAtMs: requestTimes.get(entry.event.requestId), updatedAtMs: atMs }
  return JSON.stringify({ tMs: index * 10, atMs, event })
})

fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
fs.writeFileSync(destinationPath, `${curated.join('\n')}\n`)
console.log(`curated ${curated.length} Guided reposition lifecycle events to ${destinationPath}`)
