import assert from 'node:assert/strict'
import test from 'node:test'
import { readCoreSchedule, runCoreSchedule } from './goConformance.js'

test('Go comparison schedule is deterministic and independent of caller cwd', () => {
  const first = runCoreSchedule(readCoreSchedule())
  const second = runCoreSchedule(readCoreSchedule())
  assert.deepEqual(second, first)
  assert.equal(first.events[0].envelopes[0].sequence, 1)
  assert.deepEqual(first.events.map(({ kind, atMs }) => ({ kind, atMs })), [
    { kind: 'ingest', atMs: 1000 }, { kind: 'tick', atMs: 2000 },
    { kind: 'ingest', atMs: 2100 }, { kind: 'tick', atMs: 7101 },
  ])
})

test('Go comparison schedule rejects missing explicit timestamps', () => {
  assert.throws(() => runCoreSchedule({ steps: [{ kind: 'tick' }] }), /explicit finite atMs/)
  assert.throws(() => runCoreSchedule({ steps: [{ kind: 'ingest', envelope: {} }] }), /explicit finite atMs/)
})
