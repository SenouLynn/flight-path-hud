import assert from 'node:assert/strict'
import test from 'node:test'
import { createFlightStateTracker } from './flightStateTracker.js'

const heartbeat = (sysId, armed, customMode) => ({ sysId, compId: 1, messageName: 'HEARTBEAT',
  payload: { heartbeat: { armed, baseMode: armed ? 129 : 1, customMode,
    systemStatus: 4, vehicleType: sysId === 1 ? 2 : 1, autopilotType: 3 } } })

test('tracks armed and raw mode state independently per exact target', () => {
  let nowMs = 1000
  const tracker = createFlightStateTracker({ now: () => nowMs })
  tracker.ingestEnvelope(heartbeat(1, false, 0))
  nowMs += 100
  tracker.ingestEnvelope(heartbeat(2, true, 10))
  assert.deepEqual(tracker.snapshot().map(({ sysId, armed, customMode }) => ({ sysId, armed, customMode })), [
    { sysId: 1, armed: false, customMode: 0 }, { sysId: 2, armed: true, customMode: 10 },
  ])
  assert.equal(tracker.getFreshState(1, 1).armed, false)
  assert.equal(tracker.getFreshState(2, 1).armed, true)
})

test('rejects non-heartbeats and never treats stale state as a command precondition', () => {
  let nowMs = 1000
  const tracker = createFlightStateTracker({ now: () => nowMs, staleAfterMs: 500 })
  assert.equal(tracker.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'ATTITUDE', payload: {} }), null)
  tracker.ingestEnvelope(heartbeat(1, false, 0))
  nowMs = 1501
  assert.equal(tracker.getFreshState(1, 1), null)
  assert.deepEqual(tracker.snapshot(), [])
})
