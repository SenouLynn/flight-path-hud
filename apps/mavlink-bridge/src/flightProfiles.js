/**
 * Pure synthetic flight profiles. No socket, no timer, no I/O, no module-level
 * mutable state — a profile is a function of elapsed time and its own config, so
 * one process can host N vehicles flying different patterns without them sharing
 * anything.
 *
 * ## The contract
 *
 * A profile is `(tSec, config) -> Kinematics`:
 *
 *   { headingDeg, pitchRad, rollRad, groundSpeedMps, climbMps, vNorthMps, vEastMps,
 *     position? }
 *
 * `position` is optional and is what separates the two kinds of profile:
 *
 * - **Integrated** (`snakeKinematics`) omits it. The caller accumulates position
 *   from the velocities via `stepDeadReckoning`. Simple, but numerically drifts.
 * - **Analytic** (`figureEightKinematics`) supplies it. Position comes straight
 *   from a closed-form curve, so the path closes exactly and never walks away
 *   from where it started.
 *
 * ## Why self-consistency is load-bearing
 *
 * Every field above has to describe the *same* aircraft: `groundSpeedMps` must
 * equal `hypot(vNorthMps, vEastMps)`, `headingDeg` must equal the direction of
 * that velocity, and `rollRad` must be the bank a coordinated turn at the actual
 * turn rate would need (`tan(phi) = V * psi_dot / g`).
 *
 * This is not cosmetic. The HUD cross-checks these against each other — the
 * slip/skid readout, and the `g*tan(phi)/V` fallback it uses to recover turn rate
 * when no explicit rate is present. A hand-tuned profile whose bank does not match
 * its own turn renders as a permanently uncoordinated aircraft, and the resulting
 * "bug" is in the mock rather than in the code under test. So every quantity here
 * is *derived* from the path, never dialled in by eye.
 */

export const GRAVITY_MPS2 = 9.81
export const METERS_PER_DEG_LAT = 111319.49
export const DEG_E7 = 1e7

const TWO_PI = Math.PI * 2

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360
}

function toDeg(rad) {
  return (rad * 180) / Math.PI
}

/**
 * Turn rate of a velocity vector, from the vector and its derivative:
 *
 *   psi = atan2(vE, vN)   =>   psi_dot = (vN*aE - vE*aN) / (vN^2 + vE^2)
 *
 * Analytic rather than a finite difference so the bank it feeds is exact at every
 * sample, including the instants where the path's curvature reverses sign.
 */
function turnRateRadPerSec(vNorthMps, vEastMps, aNorthMps2, aEastMps2) {
  const speedSquared = vNorthMps * vNorthMps + vEastMps * vEastMps
  if (speedSquared === 0) {
    return 0
  }

  return (vNorthMps * aEastMps2 - vEastMps * aNorthMps2) / speedSquared
}

/** Bank angle of a coordinated turn: tan(phi) = V * psi_dot / g. */
function coordinatedRollRad(turnRate, groundSpeedMps) {
  return Math.atan((turnRate * groundSpeedMps) / GRAVITY_MPS2)
}

// ---------------------------------------------------------------------------
// Snake — the original S-turn cruise
// ---------------------------------------------------------------------------

export const DEFAULT_SNAKE_CONFIG = {
  cruiseSpeedMps: 18,
  headingAmplitudeDeg: 20,
  turnFreqRadPerSec: 0.25,
  /** Heading the S-turn oscillates around. */
  centreHeadingDeg: 180,
}

/**
 * A gentle S-turn cruise, unchanged from the original single-node mock: amplitude
 * and frequency are the only knobs, and bank is derived from the resulting turn
 * rate so the two stay consistent.
 *
 * Position is integrated (no `position` field) — this profile travels in a
 * direction and keeps going, which is exactly what it is for.
 */
export function snakeKinematics(tSec, config = DEFAULT_SNAKE_CONFIG) {
  const {
    cruiseSpeedMps,
    headingAmplitudeDeg,
    turnFreqRadPerSec,
    centreHeadingDeg,
  } = { ...DEFAULT_SNAKE_CONFIG, ...config }

  const turnPhase = tSec * turnFreqRadPerSec
  const headingDeg = normalizeDeg(centreHeadingDeg + Math.sin(turnPhase) * headingAmplitudeDeg)
  const pitchRad = 0.12 * Math.sin(tSec * 0.5)
  const groundSpeedMps = cruiseSpeedMps + Math.sin(tSec * 0.2)
  const climbMps = Math.sin(tSec * 0.4)

  const headingRateRadPerSec = ((headingAmplitudeDeg * Math.PI) / 180)
    * turnFreqRadPerSec * Math.cos(turnPhase)
  const rollRad = coordinatedRollRad(headingRateRadPerSec, groundSpeedMps)

  // Velocities are NED earth-frame: project ground speed onto the heading so the
  // track actually follows the turn instead of running due north forever.
  const headingRad = (headingDeg * Math.PI) / 180

  return {
    headingDeg,
    pitchRad,
    rollRad,
    groundSpeedMps,
    climbMps,
    vNorthMps: groundSpeedMps * Math.cos(headingRad),
    vEastMps: groundSpeedMps * Math.sin(headingRad),
  }
}

// ---------------------------------------------------------------------------
// Figure eight — analytic Gerono lemniscate
// ---------------------------------------------------------------------------

/**
 * Defaults chosen so the pattern is compact enough to sit inside one map view at
 * ~zoom 16 (300 m east-west by 200 m north-south) while still flying at plausible
 * speeds (11-26 m/s) and banking hard enough to be worth looking at (0 deg at the
 * crossing, ~24 deg at the lobe tips, both signs).
 *
 * Bank scales as `eastAmplitudeM * omega^2 / g`, so shortening `lapPeriodSec`
 * steepens the turns quickly — it is the knob to reach for, not the amplitudes.
 */
export const DEFAULT_FIGURE_EIGHT_CONFIG = {
  /** East extent: the path spans +/- this. */
  eastAmplitudeM: 150,
  /** North extent: the path spans +/- this. */
  northAmplitudeM: 100,
  /** Seconds for one complete figure eight. */
  lapPeriodSec: 60,
  /**
   * Height above the node's origin that the pattern oscillates around. Non-zero
   * so the generated mission waypoints sit at a sane positive relative altitude
   * rather than straddling the launch plane.
   */
  baseAltitudeM: 100,
  /** Altitude oscillation amplitude; drives climb rate and therefore pitch. */
  altitudeAmplitudeM: 25,
  /** Phase offset of the altitude cycle against the ground track. */
  altitudePhaseRad: 0,
}

/**
 * A figure eight flown as a Gerono lemniscate, parameterised by phase
 * `theta = omega * t`:
 *
 *   east(theta)  = Ae * sin(theta)
 *   north(theta) = An * sin(2 * theta)
 *   up(theta)    = base + Ha * sin(theta + phase)
 *
 * **Position is analytic, not integrated.** That is the entire point of this
 * profile: velocity integration accumulates numerical drift, so an integrated
 * figure eight slowly walks off the map — precisely the behaviour this pattern
 * exists to avoid. Evaluating the curve directly makes closure exact and free.
 *
 * Everything else is then derived by differentiating that same curve, so the
 * kinematics cannot disagree with the path they came from:
 *
 *   vE = Ae*w*cos(theta)      aE = -Ae*w^2*sin(theta)
 *   vN = 2*An*w*cos(2*theta)  aN = -4*An*w^2*sin(2*theta)
 *
 * The pattern also sweeps the instrument ranges the way a hand-written profile
 * struggles to: curvature reverses sign at the self-crossing, so bank runs
 * full-negative through exactly zero to full-positive twice per lap, and `|v|`
 * varies around the curve on its own rather than being modulated artificially.
 */
export function figureEightKinematics(tSec, config = DEFAULT_FIGURE_EIGHT_CONFIG) {
  const {
    eastAmplitudeM,
    northAmplitudeM,
    lapPeriodSec,
    baseAltitudeM,
    altitudeAmplitudeM,
    altitudePhaseRad,
  } = { ...DEFAULT_FIGURE_EIGHT_CONFIG, ...config }

  const omega = TWO_PI / lapPeriodSec
  const theta = tSec * omega

  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)
  const sinTwoTheta = Math.sin(2 * theta)
  const cosTwoTheta = Math.cos(2 * theta)

  const eastM = eastAmplitudeM * sinTheta
  const northM = northAmplitudeM * sinTwoTheta
  const upM = baseAltitudeM + altitudeAmplitudeM * Math.sin(theta + altitudePhaseRad)

  const vEastMps = eastAmplitudeM * omega * cosTheta
  const vNorthMps = 2 * northAmplitudeM * omega * cosTwoTheta
  const climbMps = altitudeAmplitudeM * omega * Math.cos(theta + altitudePhaseRad)

  const aEastMps2 = -eastAmplitudeM * omega * omega * sinTheta
  const aNorthMps2 = -4 * northAmplitudeM * omega * omega * sinTwoTheta

  const groundSpeedMps = Math.hypot(vNorthMps, vEastMps)
  const headingDeg = normalizeDeg(toDeg(Math.atan2(vEastMps, vNorthMps)))
  const rollRad = coordinatedRollRad(
    turnRateRadPerSec(vNorthMps, vEastMps, aNorthMps2, aEastMps2),
    groundSpeedMps,
  )

  // Flight-path angle, the physically honest pitch for a craft tracking this
  // curve: the angle of the velocity vector above the horizontal.
  const pitchRad = Math.atan2(climbMps, groundSpeedMps)

  return {
    headingDeg,
    pitchRad,
    rollRad,
    groundSpeedMps,
    climbMps,
    vNorthMps,
    vEastMps,
    position: { northM, eastM, upM },
  }
}

/**
 * The four lobe extremes, in flight order — the points where `|north|` peaks
 * (`theta = pi/4, 3pi/4, 5pi/4, 7pi/4`).
 *
 * Derived from the same curve the craft flies rather than placed by hand, so the
 * mission overlay and the live track genuinely agree instead of merely looking
 * similar. Two waypoints per lobe, all four visited once per lap.
 */
export function figureEightWaypoints(config = DEFAULT_FIGURE_EIGHT_CONFIG) {
  const merged = { ...DEFAULT_FIGURE_EIGHT_CONFIG, ...config }
  const lapPeriodSec = merged.lapPeriodSec

  return [1, 3, 5, 7].map((quarter, index) => {
    const theta = (quarter * Math.PI) / 4
    const { position } = figureEightKinematics((theta / TWO_PI) * lapPeriodSec, merged)
    return { seq: index, ...position }
  })
}

// ---------------------------------------------------------------------------
// Position accumulation
// ---------------------------------------------------------------------------

export const ZERO_POSITION = { northM: 0, eastM: 0, upM: 0 }

/** Guards against a huge first step after a pause; matches the original mock. */
const MAX_STEP_SEC = 5

/**
 * Advance a node's position by one tick.
 *
 * Analytic profiles carry their own `position` and are passed straight through —
 * the previous state is deliberately ignored, which is what stops drift from
 * accumulating. Integrated profiles fall back to dead reckoning off the
 * velocities.
 */
export function stepDeadReckoning(state, kinematics, dtSec) {
  if (kinematics.position !== undefined) {
    return { ...kinematics.position }
  }

  const step = Math.min(Math.max(dtSec, 0), MAX_STEP_SEC)
  const previous = state ?? ZERO_POSITION

  return {
    northM: previous.northM + kinematics.vNorthMps * step,
    eastM: previous.eastM + kinematics.vEastMps * step,
    upM: previous.upM + kinematics.climbMps * step,
  }
}

// ---------------------------------------------------------------------------
// Geodesy (geodussy lol)
// ---------------------------------------------------------------------------

/** Longitude degrees shrink with latitude; everything here is one tangent plane. */
export function metersPerDegLon(latDeg) {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180)
}

/**
 * Local ENU offset -> absolute position, in the wire's integer units. Mirrors
 * logic/position.ts and the web mock so the dead-reckoned and absolute GPS paths
 * agree.
 */
export function toGeodetic(origin, position) {
  const perDegLon = metersPerDegLon(origin.latDegE7 / DEG_E7)

  return {
    latDegE7: Math.round(origin.latDegE7 + (position.northM / METERS_PER_DEG_LAT) * DEG_E7),
    lonDegE7: Math.round(origin.lonDegE7 + (position.eastM / perDegLon) * DEG_E7),
    altMm: Math.round(origin.altMm + position.upM * 1000),
  }
}

export const PROFILES = {
  snake: snakeKinematics,
  figureEight: figureEightKinematics,
}
