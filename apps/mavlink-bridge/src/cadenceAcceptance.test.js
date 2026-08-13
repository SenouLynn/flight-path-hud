import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCadence, summarizeIntervals } from './cadenceAcceptance.js'

test('summarizes ordered arrival intervals', () => {
  assert.deepEqual(summarizeIntervals([0, 490, 1000, 1500]), {
    intervalsMs: [490, 510, 500], medianMs: 500, maximumMs: 510,
  })
})

test('accepts bounded scheduler jitter', () => {
  const result = assertCadence([0, 480, 990, 1490, 2010, 2500], 500)
  assert.equal(result.medianMs, 500)
})

test('rejects wrong rate, excessive outliers, and long gaps', () => {
  assert.throws(() => assertCadence([0, 100, 200, 300, 400], 500), /median/)
  assert.throws(() => assertCadence([0, 500, 1000, 1100, 1200, 1700], 500), /intervals passed/)
  assert.throws(() => assertCadence([0, 500, 1000, 2501, 3001], 500, { minimumPassingFraction: 0.5 }), /maximum gap/)
})

test('rejects invalid timestamp input', () => {
  assert.throws(() => summarizeIntervals([1]), /two timestamps/)
  assert.throws(() => summarizeIntervals([1, 1]), /increase/)
})
