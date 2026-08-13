import assert from 'node:assert/strict'
import test from 'node:test'
import { guidedPositionError, observesGuidedTarget } from './guidedRepositionObservation.js'

test('computes portable horizontal and relative-altitude error', () => {
  const target = { latitudeDeg: 35, longitudeDeg: -80, relativeAltitudeM: 25,
    arrivalRadiusM: 5, altitudeToleranceM: 2 }
  const exact = observesGuidedTarget({ latDegE7: 350000000, lonDegE7: -800000000,
    relativeAltMm: 25000 }, target)
  assert.deepEqual(exact, { horizontalDistanceM: 0, altitudeErrorM: 0, arrived: true })
  const offset = guidedPositionError({ latDegE7: 350001000, lonDegE7: -800000000,
    relativeAltMm: 30000 }, target)
  assert.ok(offset.horizontalDistanceM > 10 && offset.horizontalDistanceM < 12)
  assert.equal(offset.altitudeErrorM, 5)
})

test('requires both horizontal and altitude tolerances', () => {
  const target = { latitudeDeg: 35, longitudeDeg: -80, relativeAltitudeM: 25,
    arrivalRadiusM: 20, altitudeToleranceM: 2 }
  assert.equal(observesGuidedTarget({ latDegE7: 350001000, lonDegE7: -800000000,
    relativeAltMm: 30000 }, target).arrived, false)
  assert.equal(observesGuidedTarget(null, target), null)
})
