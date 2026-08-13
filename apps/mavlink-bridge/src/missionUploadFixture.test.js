import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMissionUploadRouter } from './missionUploadRouter.js'
import { readRecording } from './recording.js'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures/mixed-sitl-mission-upload-v2.jsonl')

function fold() {
  const router = createMissionUploadRouter({
    send: () => assert.fail('mission-upload replay emitted MAVLink'),
    canSend: () => false, enabled: () => false, isLive: () => false,
  })
  const histories = new Map()
  for (const entry of readRecording(fixture)) {
    assert.equal(entry.data, null)
    const frame = router.ingestRecordedEvent(entry.event)
    assert.notEqual(frame, null)
    const history = histories.get(frame.requestId) ?? []
    history.push(frame)
    histories.set(frame.requestId, history)
  }
  return { histories, snapshots: router.snapshotForNewClient() }
}

test('real-SITL fixture preserves six successful target-scoped upload lifecycles', () => {
  const { histories, snapshots } = fold()
  assert.equal(histories.size, 6)
  assert.equal(snapshots.length, 6)
  for (const sysId of [1, 2]) {
    const target = snapshots.filter((frame) => frame.sysId === sysId && frame.compId === 1)
    assert.equal(target.length, 3, `target ${sysId}:1 includes test, restore, and cleanup`)
    const expectedCount = sysId === 1 ? 3 : 4
    for (const terminal of target) {
      assert.equal(terminal.status, 'complete')
      assert.equal(terminal.itemCount, expectedCount)
      assert.equal(terminal.requestedCount, expectedCount)
      const statuses = histories.get(terminal.requestId).map((frame) => frame.status)
      assert.equal(statuses[0], 'clearing')
      assert.ok(statuses.includes('uploading'))
      assert.ok(statuses.includes('awaitingReadback'))
      assert.equal(statuses.at(-1), 'complete')
    }
  }
})

test('mission-upload lifecycle replay is deterministic and passive', () => {
  assert.deepEqual(fold(), fold())
})
