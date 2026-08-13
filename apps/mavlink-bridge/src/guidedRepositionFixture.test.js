import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createGuidedRepositionRouter } from './guidedRepositionRouter.js'
import { readRecording } from './recording.js'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)),
  '../test-fixtures/mixed-sitl-guided-reposition-v2.jsonl')

function fold() {
  const router = createGuidedRepositionRouter({
    send: () => assert.fail('Guided replay emitted MAVLink'), canSend: () => false,
    getFlightState: () => null, enabled: () => false, isIsolatedSitl: () => false,
    isLive: () => false,
  })
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

test('real-SITL fixture proves distinct Copter and Plane Guided arrivals', () => {
  const { histories, snapshots } = fold()
  assert.equal(histories.size, 2)
  assert.deepEqual(snapshots.map(({ sysId, vehicleType, guidedCustomMode, status,
    ackResult, observed, attempts, loiterRadiusM, loiterDirection }) => ({ sysId,
    vehicleType, guidedCustomMode, status, ackResult, observed, attempts,
    loiterRadiusM, loiterDirection })), [
    { sysId: 1, vehicleType: 2, guidedCustomMode: 4, status: 'complete',
      ackResult: 0, observed: true, attempts: 1, loiterRadiusM: null, loiterDirection: null },
    { sysId: 2, vehicleType: 1, guidedCustomMode: 15, status: 'complete',
      ackResult: 0, observed: true, attempts: 1, loiterRadiusM: 75, loiterDirection: 'clockwise' },
  ])
  for (const history of histories.values()) {
    assert.deepEqual(history.map((frame) => frame.status),
      ['awaitingAck', 'awaitingObservation', 'complete'])
    assert.ok(history.every((frame) => frame.confirmation
      && frame.safetyCase === 'isolated-sitl-guided'))
    const terminal = history.at(-1)
    assert.ok(terminal.horizontalDistanceM <= terminal.arrivalRadiusM)
    assert.ok(terminal.altitudeErrorM <= terminal.altitudeToleranceM)
  }
})

test('Guided lifecycle replay is deterministic and passive', () => {
  assert.deepEqual(fold(), fold())
})
