import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createArmDisarmRouter } from './armDisarmRouter.js'
import { readRecording } from './recording.js'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures/mixed-sitl-arm-disarm-v2.jsonl')

function fold() {
  const router = createArmDisarmRouter({ send: () => assert.fail('arm/disarm replay emitted MAVLink'),
    canSend: () => false, getFlightState: () => null, enabled: () => false,
    isIsolatedSitl: () => false, isLive: () => false })
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

test('real-SITL fixture proves isolated standard arm then final disarm for both targets', () => {
  const { histories, snapshots } = fold()
  assert.equal(histories.size, 4)
  assert.deepEqual(snapshots.map(({ sysId, arm, status, ackResult, observed, attempts }) => (
    { sysId, arm, status, ackResult, observed, attempts }
  )), [
    { sysId: 1, arm: true, status: 'complete', ackResult: 0, observed: true, attempts: 1 },
    { sysId: 1, arm: false, status: 'complete', ackResult: 0, observed: true, attempts: 1 },
    { sysId: 2, arm: true, status: 'complete', ackResult: 0, observed: true, attempts: 1 },
    { sysId: 2, arm: false, status: 'complete', ackResult: 0, observed: true, attempts: 1 },
  ])
  for (const sysId of [1, 2]) assert.equal(snapshots.filter((frame) => frame.sysId === sysId).at(-1).arm, false)
  for (const history of histories.values()) {
    assert.deepEqual(history.map((frame) => frame.status), ['awaitingAck', 'awaitingObservation', 'complete'])
    assert.ok(history.every((frame) => frame.confirmation && frame.safetyCase === 'sitl-no-propulsion'))
  }
})

test('arm/disarm lifecycle replay is deterministic and passive', () => {
  assert.deepEqual(fold(), fold())
})
