import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createModeChangeRouter } from './modeChangeRouter.js'
import { readRecording } from './recording.js'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures/mixed-sitl-mode-change-v2.jsonl')

function fold() {
  const router = createModeChangeRouter({ send: () => assert.fail('mode replay emitted MAVLink'),
    canSend: () => false, getFlightState: () => null, enabled: () => false, isLive: () => false })
  const histories = new Map()
  for (const entry of readRecording(fixture)) {
    assert.equal(entry.data, null)
    const frame = router.ingestRecordedEvent(entry.event)
    assert.notEqual(frame, null)
    const history = histories.get(frame.requestId) ?? []
    history.push(frame); histories.set(frame.requestId, history)
  }
  return { histories, snapshots: router.snapshotForNewClient() }
}

test('real-SITL fixture proves target-specific LOITER transitions and restoration', () => {
  const { histories, snapshots } = fold()
  assert.equal(histories.size, 4)
  assert.deepEqual(snapshots.map(({ sysId, mode, customMode, status, ackResult, observed }) => (
    { sysId, mode, customMode, status, ackResult, observed }
  )), [
    { sysId: 1, mode: 'LOITER', customMode: 5, status: 'complete', ackResult: 0, observed: true },
    { sysId: 1, mode: 'STABILIZE', customMode: 0, status: 'complete', ackResult: 0, observed: true },
    { sysId: 2, mode: 'LOITER', customMode: 12, status: 'complete', ackResult: 0, observed: true },
    { sysId: 2, mode: 'MANUAL', customMode: 0, status: 'complete', ackResult: 0, observed: true },
  ])
  for (const history of histories.values()) {
    assert.deepEqual(history.map((frame) => frame.status), ['awaitingAck', 'awaitingObservation', 'complete'])
    assert.ok(history.every((frame) => frame.confirmation && frame.actor === 'sitl-mode-change-controller'))
  }
})

test('mode-change lifecycle replay is deterministic and passive', () => {
  assert.deepEqual(fold(), fold())
})
