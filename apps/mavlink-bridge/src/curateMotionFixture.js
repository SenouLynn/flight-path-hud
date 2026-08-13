import fs from 'node:fs'
import path from 'node:path'
import { createBridgeCore } from './bridgeCore.js'
import { readRecording } from './recording.js'

const [sourcePath, destinationPath] = process.argv.slice(2)

if (sourcePath === undefined || destinationPath === undefined) {
  console.error('usage: node src/curateMotionFixture.js <recording.jsonl> <fixture.jsonl>')
  process.exit(2)
}

const entries = readRecording(sourcePath)
const core = createBridgeCore({ now: () => 0 })
const selected = []
const firstByMessage = new Set()
const missionSequences = new Set()
const lastSampleMs = new Map()

for (const entry of entries) {
  const frames = core.ingestDatagram(entry.data, entry.atMs)
  let keep = false

  for (const frame of frames) {
    const system = `${frame.sysId}:${frame.compId}`
    if (system !== '1:1' && system !== '2:1') {
      continue
    }

    const firstKey = `${system}:${frame.messageName}`
    if (['HEARTBEAT', 'HOME_POSITION', 'MISSION_COUNT'].includes(frame.messageName)
      && !firstByMessage.has(firstKey)) {
      firstByMessage.add(firstKey)
      keep = true
    }

    if (frame.messageName === 'MISSION_ITEM_INT') {
      keep = true
    }

    if (frame.messageName === 'MISSION_CURRENT') {
      const sequence = frame.payload.missionCurrent?.seq
      const sequenceKey = `${system}:${sequence}`
      if (!missionSequences.has(sequenceKey)) {
        missionSequences.add(sequenceKey)
        keep = true
      }
    }

    if (['GLOBAL_POSITION_INT', 'ATTITUDE', 'GPS_RAW_INT'].includes(frame.messageName)) {
      const sampleKey = `${system}:${frame.messageName}`
      const lastMs = lastSampleMs.get(sampleKey) ?? -Infinity
      // One sample every ten seconds retains coherent motion/instrument changes
      // without checking thousands of near-duplicate simulator packets into Git.
      if (entry.tMs - lastMs >= 10_000) {
        lastSampleMs.set(sampleKey, entry.tMs)
        keep = true
      }
    }
  }

  if (keep) {
    selected.push(entry)
  }
}

if (selected.length === 0) {
  throw new Error(`no motion evidence found in ${sourcePath}`)
}

const firstTms = selected[0].tMs
const syntheticEpochMs = 1_700_000_000_000
const lines = selected.map((entry) => {
  const tMs = entry.tMs - firstTms
  return JSON.stringify({
    tMs,
    atMs: syntheticEpochMs + tMs,
    base64: entry.data.toString('base64'),
  })
})

fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
fs.writeFileSync(destinationPath, `${lines.join('\n')}\n`)
console.log(`curated ${selected.length} of ${entries.length} datagrams into ${destinationPath}`)
