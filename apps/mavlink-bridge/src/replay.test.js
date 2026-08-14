import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBridgeCore } from './bridgeCore.js'
import { computeFrameCrc } from './normalize.js'
import { createJsonlRecorder, readRecording } from './recording.js'
import { createReplayIngress } from './replayIngress.js'

const CRC_EXTRA = { 0: 50, 30: 39, 74: 20 }

function mavlinkV1Frame(messageId, payload, sequence) {
  const frame = Buffer.alloc(6 + payload.length + 2)
  frame[0] = 0xFE
  frame[1] = payload.length
  frame[2] = sequence
  frame[3] = 1
  frame[4] = 1
  frame[5] = messageId
  payload.copy(frame, 6)
  frame.writeUInt16LE(computeFrameCrc(frame, 1, 6 + payload.length, CRC_EXTRA[messageId]), 6 + payload.length)
  return frame
}

function buildSession() {
  const attitude = Buffer.alloc(28)
  attitude.writeFloatLE(0.1, 4)
  attitude.writeFloatLE(-0.2, 8)

  const vfr = Buffer.alloc(20)
  vfr.writeFloatLE(22.5, 0)
  vfr.writeFloatLE(20.25, 4)
  vfr.writeInt16LE(165, 16)

  return [
    Buffer.from(JSON.stringify({
      recvTimestampMs: 5000, sysId: 2, compId: 1, messageName: 'VFR_HUD', sequence: 3,
      payload: { timestampMs: 5000, vfrHud: {
        headingDeg: 90, airSpeedMps: 12, groundSpeedMps: 11, climbMps: 0,
      } },
    })),
    mavlinkV1Frame(0, Buffer.alloc(9), 1),
    mavlinkV1Frame(30, attitude, 2),
    mavlinkV1Frame(74, vfr, 3),
    Buffer.from('not a mavlink frame at all'),
  ]
}

function tempFile(name) {
  return path.join(os.tmpdir(), `mavlink-bridge-${process.pid}-${name}.jsonl`)
}

test('replaying a recording reproduces the live envelope stream exactly', async () => {
  const datagrams = buildSession()
  const file = tempFile('contract')

  // Fixed clock so the recording is reproducible; the recorder stamps each entry.
  let clock = 1_700_000_000_000
  const recorder = createJsonlRecorder(file, { now: () => (clock += 150) })

  const liveCore = createBridgeCore({ now: () => clock })
  const liveFrames = []
  for (const datagram of datagrams) {
    recorder.record(datagram)
    liveFrames.push(...liveCore.ingestDatagram(datagram, clock))
  }
  await recorder.close()

  // Replay through a fresh core, driven only by what the file preserved.
  const replayCore = createBridgeCore({ now: () => 0 })
  const replayFrames = []
  for (const entry of readRecording(file)) {
    replayFrames.push(...replayCore.ingestDatagram(entry.data, entry.atMs))
  }

  fs.unlinkSync(file)

  assert.ok(liveFrames.length > 0, 'expected the session to produce frames')
  assert.deepEqual(replayFrames, liveFrames)
})

test('recording preserves the raw bytes, so replay re-runs the decoder', async () => {
  const datagrams = buildSession()
  const file = tempFile('bytes')

  const recorder = createJsonlRecorder(file)
  datagrams.forEach((datagram) => recorder.record(datagram))
  await recorder.close()

  const restored = readRecording(file).map((entry) => entry.data)
  fs.unlinkSync(file)

  assert.equal(restored.length, datagrams.length)
  restored.forEach((buffer, index) => {
    assert.ok(buffer.equals(datagrams[index]), `datagram ${index} round-tripped unchanged`)
  })
})

test('recording preserves normalized command lifecycle events alongside datagrams', async () => {
  const file = tempFile('command-events')
  let clock = 100
  const recorder = createJsonlRecorder(file, { now: () => (clock += 10) })
  const event = { type: 'commandStatus', requestId: 'request-1', status: 'acknowledged' }
  recorder.record(Buffer.from([1, 2, 3]))
  recorder.recordEvent(event)
  await recorder.close()

  const entries = readRecording(file)
  fs.unlinkSync(file)
  assert.ok(entries[0].data.equals(Buffer.from([1, 2, 3])))
  assert.equal(entries[0].event, null)
  assert.equal(entries[1].data, null)
  assert.deepEqual(entries[1].event, event)
})

test('replay ingress emits command events without treating them as MAVLink bytes', async () => {
  const file = tempFile('command-event-replay')
  const event = { type: 'commandStatus', requestId: 'request-2', status: 'timedOut' }
  const recorder = createJsonlRecorder(file)
  recorder.recordEvent(event)
  await recorder.close()
  const ingress = createReplayIngress(file, { speed: 1000 })

  const seen = await new Promise((resolve) => {
    ingress.start(() => assert.fail('event must not be emitted as a datagram'), (value) => resolve(value))
  })
  fs.unlinkSync(file)
  assert.deepEqual(seen, event)
})

test('replay ingress emits datagrams in order with the recorded pacing', async () => {
  const file = tempFile('pacing')

  let clock = 0
  const recorder = createJsonlRecorder(file, { now: () => (clock += 20) })
  const datagrams = buildSession().slice(0, 3)
  datagrams.forEach((datagram) => recorder.record(datagram))
  await recorder.close()

  const ingress = createReplayIngress(file, { speed: 100 })
  const seen = []

  await new Promise((resolve) => {
    const stop = ingress.start((data) => {
      seen.push(data)
      if (seen.length === datagrams.length) {
        stop()
        resolve()
      }
    })
  })

  fs.unlinkSync(file)

  assert.equal(seen.length, datagrams.length)
  seen.forEach((buffer, index) => {
    assert.ok(buffer.equals(datagrams[index]))
  })
})

test('the decode clock is injectable so replay does not pick up the current time', () => {
  const core = createBridgeCore({ now: () => 0 })
  const [frame] = core.ingestDatagram(mavlinkV1Frame(0, Buffer.alloc(9), 1), 424242)

  assert.equal(frame.recvTimestampMs, 424242)
  assert.equal(frame.payload.timestampMs, 424242)
})
