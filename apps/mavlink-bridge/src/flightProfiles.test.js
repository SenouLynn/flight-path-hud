import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_FIGURE_EIGHT_CONFIG,
  GRAVITY_MPS2,
  ZERO_POSITION,
  figureEightKinematics,
  figureEightWaypoints,
  metersPerDegLon,
  snakeKinematics,
  stepDeadReckoning,
  toGeodetic,
} from './flightProfiles.js'

const LAP = DEFAULT_FIGURE_EIGHT_CONFIG.lapPeriodSec

/** Samples one full lap, excluding the duplicate endpoint. */
function sampleLap(count = 720, config = DEFAULT_FIGURE_EIGHT_CONFIG) {
  return Array.from({ length: count }, (_, index) => {
    const tSec = (index / count) * config.lapPeriodSec
    return { tSec, kinematics: figureEightKinematics(tSec, config) }
  })
}

/** Signed smallest-arc difference, so a wrap through 360 doesn't read as a huge turn. */
function headingDeltaDeg(aDeg, bDeg) {
  return ((aDeg - bDeg + 540) % 360) - 180
}

// ---------------------------------------------------------------------------
// Self-consistency — the property the HUD cross-checks
// ---------------------------------------------------------------------------

for (const [name, profile] of [['snake', snakeKinematics], ['figureEight', figureEightKinematics]]) {
  test(`${name}: ground speed equals the magnitude of its own velocity`, () => {
    for (let index = 0; index < 500; index += 1) {
      const { groundSpeedMps, vNorthMps, vEastMps } = profile(index * 0.37)
      assert.ok(
        Math.abs(Math.hypot(vNorthMps, vEastMps) - groundSpeedMps) < 1e-9,
        `t=${index * 0.37}: speed ${groundSpeedMps} != |v| ${Math.hypot(vNorthMps, vEastMps)}`,
      )
    }
  })

  test(`${name}: heading is the direction of its own velocity`, () => {
    for (let index = 0; index < 500; index += 1) {
      const tSec = index * 0.37
      const { headingDeg, vNorthMps, vEastMps } = profile(tSec)
      const fromVelocity = ((Math.atan2(vEastMps, vNorthMps) * 180) / Math.PI + 360) % 360
      assert.ok(
        Math.abs(headingDeltaDeg(headingDeg, fromVelocity)) < 1e-9,
        `t=${tSec}: heading ${headingDeg} != velocity direction ${fromVelocity}`,
      )
    }
  })

  /*
   * The one that actually catches a hand-tuned profile: differentiate the heading
   * the profile reports, and check the bank it reports is the coordinated bank for
   * that turn rate. If these disagree the HUD's slip/skid readout shows a
   * permanently uncoordinated aircraft and the fault looks like it is in the HUD.
   */
  test(`${name}: bank matches its own turn rate (tan(phi) = V*psi_dot/g)`, () => {
    const h = 1e-3

    for (let index = 1; index < 300; index += 1) {
      const tSec = index * 0.41
      const { rollRad, groundSpeedMps } = profile(tSec)
      const turnRate = (headingDeltaDeg(profile(tSec + h).headingDeg, profile(tSec - h).headingDeg)
        * Math.PI / 180) / (2 * h)
      const expectedRoll = Math.atan((turnRate * groundSpeedMps) / GRAVITY_MPS2)

      assert.ok(
        Math.abs(rollRad - expectedRoll) < 1e-5,
        `t=${tSec}: roll ${rollRad} != coordinated ${expectedRoll}`,
      )
    }
  })
}

// ---------------------------------------------------------------------------
// Figure eight — the properties that justify the analytic form
// ---------------------------------------------------------------------------

test('figureEight closes exactly after one lap, so the pattern never drifts', () => {
  // The whole reason position is analytic rather than integrated. An integrated
  // version accumulates error here and walks the pattern off the map.
  for (const tSec of [0, 7.5, 23.25, 41, 59.9]) {
    const start = figureEightKinematics(tSec).position
    const afterLaps = figureEightKinematics(tSec + LAP * 100).position

    assert.ok(Math.abs(start.northM - afterLaps.northM) < 1e-6, `north drifted at t=${tSec}`)
    assert.ok(Math.abs(start.eastM - afterLaps.eastM) < 1e-6, `east drifted at t=${tSec}`)
    assert.ok(Math.abs(start.upM - afterLaps.upM) < 1e-6, `alt drifted at t=${tSec}`)
  }
})

test('figureEight stays inside its configured envelope', () => {
  const { eastAmplitudeM, northAmplitudeM, baseAltitudeM, altitudeAmplitudeM } = DEFAULT_FIGURE_EIGHT_CONFIG

  for (const { kinematics } of sampleLap()) {
    const { northM, eastM, upM } = kinematics.position
    assert.ok(Math.abs(eastM) <= eastAmplitudeM + 1e-9)
    assert.ok(Math.abs(northM) <= northAmplitudeM + 1e-9)
    assert.ok(upM >= baseAltitudeM - altitudeAmplitudeM - 1e-9)
    assert.ok(upM <= baseAltitudeM + altitudeAmplitudeM + 1e-9)
    // The pattern must stay above its launch plane, or the generated mission
    // waypoints end up at negative relative altitude.
    assert.ok(upM > 0)
  }
})

test('figureEight crosses itself exactly once per lap, at the origin', () => {
  // A lemniscate that failed to cross would be an oval — the "8" is the point.
  // The crossing point is the origin, reached twice per lap, half a lap apart.
  const groundDistanceM = (tSec) => {
    const { northM, eastM } = figureEightKinematics(tSec).position
    return Math.hypot(northM, eastM)
  }

  assert.ok(groundDistanceM(0) < 1e-9, 'should pass through the origin at the start of the lap')
  assert.ok(groundDistanceM(LAP / 2) < 1e-9, 'should pass through the origin at the half lap')

  // And nowhere else: every phase more than 2% of a lap from either pass is
  // comfortably clear of the crossing, so there is no third approach.
  const nearPassSec = LAP * 0.02
  for (const { tSec } of sampleLap(3600)) {
    const fromCrossingSec = Math.min(tSec, Math.abs(tSec - LAP / 2), LAP - tSec)
    if (fromCrossingSec > nearPassSec) {
      assert.ok(
        groundDistanceM(tSec) > 5,
        `unexpected approach to the crossing at t=${tSec.toFixed(2)}`,
      )
    }
  }
})

test('figureEight flies through all four of its own waypoints', () => {
  // The mission overlay is generated from figureEightWaypoints, so this is what
  // makes the planned route and the live track agree rather than merely resemble.
  const lap = sampleLap(3600)

  for (const waypoint of figureEightWaypoints()) {
    const closestM = Math.min(...lap.map(({ kinematics }) => Math.hypot(
      kinematics.position.northM - waypoint.northM,
      kinematics.position.eastM - waypoint.eastM,
      kinematics.position.upM - waypoint.upM,
    )))

    assert.ok(closestM < 1, `waypoint ${waypoint.seq} missed by ${closestM.toFixed(2)} m`)
  }
})

test('figureEight waypoints are the four distinct lobe extremes', () => {
  const waypoints = figureEightWaypoints()
  assert.equal(waypoints.length, 4)
  assert.deepEqual(waypoints.map((waypoint) => waypoint.seq), [0, 1, 2, 3])

  const { northAmplitudeM } = DEFAULT_FIGURE_EIGHT_CONFIG
  for (const waypoint of waypoints) {
    assert.ok(Math.abs(Math.abs(waypoint.northM) - northAmplitudeM) < 1e-6, 'not at a north extreme')
  }

  const corners = new Set(waypoints.map((waypoint) => (
    `${Math.sign(waypoint.northM)}:${Math.sign(waypoint.eastM)}`
  )))
  assert.equal(corners.size, 4, 'the four waypoints should occupy four distinct quadrants')
})

test('figureEight bank passes through zero at the crossing and reverses sign', () => {
  const rolls = sampleLap().map(({ kinematics }) => kinematics.rollRad)

  assert.ok(Math.max(...rolls) > 0.3, 'expected a meaningful positive bank')
  assert.ok(Math.min(...rolls) < -0.3, 'expected a meaningful negative bank')
  // Curvature reverses at the self-crossing, so bank crosses zero there.
  assert.ok(Math.abs(figureEightKinematics(0).rollRad) < 1e-9)
  assert.ok(Math.abs(figureEightKinematics(LAP / 2).rollRad) < 1e-9)
})

test('figureEight sweeps speed and climb rather than holding them constant', () => {
  const speeds = sampleLap().map(({ kinematics }) => kinematics.groundSpeedMps)
  const climbs = sampleLap().map(({ kinematics }) => kinematics.climbMps)

  assert.ok(Math.max(...speeds) - Math.min(...speeds) > 5, 'speed should vary around the curve')
  assert.ok(Math.min(...speeds) > 1, 'speed should never collapse to a stall')
  assert.ok(Math.max(...climbs) > 1 && Math.min(...climbs) < -1, 'climb should swing both ways')
})

// ---------------------------------------------------------------------------
// Snake — regression guard on the extraction
// ---------------------------------------------------------------------------

/**
 * Captured from the pre-refactor sampleSender.js before it was deleted. These
 * pin the existing single-node stream so pulling the profile out of that file
 * cannot have changed what node 1 flies.
 */
const SNAKE_BASELINE = [
  { tSec: 0, headingDeg: 180, pitchRad: 0, rollRad: 0.15877416566108582, groundSpeedMps: 18, climbMps: 0, vNorthMps: -18, vEastMps: 2.204364238465236e-15 },
  { tSec: 1, headingDeg: 184.94807918509048, pitchRad: 0.05753106463250436, rollRad: 0.15558873355695668, groundSpeedMps: 18.19866933079506, climbMps: 0.3894183423086505, vNorthMps: -18.130847779166118, vEastMps: -1.569689211381567 },
  { tSec: 3.7, headingDeg: 195.97241526397625, pitchRad: 0.11535302435703598, rollRad: 0.09964575722697175, groundSpeedMps: 18.674287911628145, climbMps: 0.99588084453764, vNorthMps: -17.953353742064273, vEastMps: -5.138688394784009 },
  { tSec: 10, headingDeg: 191.9694428820792, pitchRad: -0.11507091295957661, rollRad: -0.13395397046560342, groundSpeedMps: 18.90929742682568, climbMps: -0.7568024953079282, vNorthMps: -18.49817801655893, vEastMps: -3.9215990671985117 },
  { tSec: 47.25, headingDeg: 166.31068535276154, pitchRad: -0.11976152230662761, rollRad: 0.1160487790490144, groundSpeedMps: 17.97478063485634, climbMps: 0.05042268780681477, vNorthMps: -17.464175932917687, vEastMps: 4.253856821204164 },
]

test('snakeKinematics reproduces the pre-refactor sampleSender values exactly', () => {
  for (const { tSec, ...expected } of SNAKE_BASELINE) {
    const actual = snakeKinematics(tSec)
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(actual[field], value, `t=${tSec} ${field}`)
    }
  }
})

test('snakeKinematics integrates rather than supplying position', () => {
  // Its whole job is to travel somewhere and keep going, so it must NOT close.
  assert.equal(snakeKinematics(0).position, undefined)
})

// ---------------------------------------------------------------------------
// Position accumulation
// ---------------------------------------------------------------------------

test('stepDeadReckoning integrates velocity for profiles without a position', () => {
  const next = stepDeadReckoning(
    { northM: 10, eastM: 20, upM: 30 },
    { vNorthMps: 2, vEastMps: -4, climbMps: 1 },
    0.5,
  )

  assert.deepEqual(next, { northM: 11, eastM: 18, upM: 30.5 })
})

test('stepDeadReckoning passes analytic positions straight through, ignoring history', () => {
  // Ignoring the previous state is exactly what stops drift accumulating.
  const next = stepDeadReckoning(
    { northM: 9999, eastM: 9999, upM: 9999 },
    { vNorthMps: 5, vEastMps: 5, climbMps: 5, position: { northM: 1, eastM: 2, upM: 3 } },
    0.5,
  )

  assert.deepEqual(next, { northM: 1, eastM: 2, upM: 3 })
})

test('stepDeadReckoning clamps an oversized or negative step', () => {
  const kinematics = { vNorthMps: 1, vEastMps: 0, climbMps: 0 }
  // A long pause must not teleport the vehicle across the map on resume.
  assert.equal(stepDeadReckoning(ZERO_POSITION, kinematics, 3600).northM, 5)
  assert.equal(stepDeadReckoning(ZERO_POSITION, kinematics, -1).northM, 0)
})

test('stepDeadReckoning treats a missing previous state as the origin', () => {
  assert.deepEqual(
    stepDeadReckoning(null, { vNorthMps: 1, vEastMps: 2, climbMps: 3 }, 1),
    { northM: 1, eastM: 2, upM: 3 },
  )
})

// ---------------------------------------------------------------------------
// Geodesy
// ---------------------------------------------------------------------------

const ORIGIN = { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 }

test('toGeodetic round-trips a local offset back to metres', () => {
  const fixed = toGeodetic(ORIGIN, { northM: 250, eastM: -400, upM: 30 })

  const northM = ((fixed.latDegE7 - ORIGIN.latDegE7) / 1e7) * 111319.49
  const eastM = ((fixed.lonDegE7 - ORIGIN.lonDegE7) / 1e7) * metersPerDegLon(ORIGIN.latDegE7 / 1e7)

  assert.ok(Math.abs(northM - 250) < 0.01)
  assert.ok(Math.abs(eastM - -400) < 0.01)
  assert.equal(fixed.altMm, 530000)
})

test('toGeodetic shrinks longitude degrees with latitude', () => {
  // A degree of longitude is ~111 km at the equator and ~0 at the pole; getting
  // this backwards puts the whole pattern in the wrong place east-west.
  assert.ok(metersPerDegLon(0) > metersPerDegLon(47.4))
  assert.ok(metersPerDegLon(47.4) > metersPerDegLon(80))
})
