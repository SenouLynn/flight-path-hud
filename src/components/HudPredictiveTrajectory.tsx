import { resolveAttitude } from '../logic/attitude'
import { resolvePredictiveTrajectory } from '../logic/trajectory'
import type { ForwardPathPoint, TrajectoryConfig } from '../logic/trajectory'
import type { TelemetrySample } from '../logic/telemetry'

interface HudPredictiveTrajectoryProps {
  sample: TelemetrySample | null
  width?: number
  height?: number
  /** Overrides the trajectory integrator config (e.g. a playground stall speed). */
  config?: TrajectoryConfig
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Two decoupled layers roll about the fixed boresight cross:
//   • World (horizon + grid) rotates like the attitude indicator: rotate(-roll).
//   • Flight path banks the opposite way: rotate(+roll) — a right bank starts the
//     corridor left of boresight and sweeps it out to the right, mirroring the
//     felt motion. Pitch drives the path camera height so nose-down lifts the
//     start above the boresight and the corridor recedes downward.
const WORLD_PITCH_PX_PER_DEG = 6 // matches HudAttitudeIndicator
const PITCH_CLAMP_DEG = 30
const PATH_PITCH_CAM_GAIN_M_PER_DEG = 0.28 // nose-down shrinks camera height -> start rises

// Forward-looking perspective camera, sitting slightly ABOVE the flight path so
// the near future drops to the bottom of the frame and recedes up to a
// vanishing point at center — a "road to the horizon" for the flight path.
const FOCAL = 240 // px·m — larger = tighter/longer corridor
const NEAR_M = 6 // depth of the aircraft-now plane (avoids divide-by-zero)
const MIN_DEPTH_M = 1.2 // clamp so hard turns can't wrap behind the camera
const CAM_HEIGHT_M = 3.6 // world-grid eye height above the path — near-field drop
const PATH_CAM_HEIGHT_M = 2.3 // flight-path eye height — smaller = start nearer the boresight
const CORRIDOR_HALF_M = 3.0 // corridor half-width in meters

// Vertical-sense surface colors: the corridor FILL reads "sky" where it rises
// above the boresight and "ground" where it drops below, so an up-then-down swoop
// is legible from the two-tone surface area (not just the outline).
const PATH_SKY_COLOR = '#79d2ff'
const PATH_GROUND_COLOR = '#f0a24e'
const PATH_LEVEL_COLOR = '#6f88a3'

interface Projected {
  x: number
  y: number
  depth: number
  nearness: number // 1 at the near plane → 0 far away, for width/opacity cues
}

function makeProjector(centerX: number, centerY: number, camHeightM: number) {
  const nearInvZ = FOCAL / NEAR_M
  return function project(forwardM: number, lateralM: number, verticalM: number): Projected {
    const depth = Math.max(MIN_DEPTH_M, forwardM + NEAR_M)
    const invZ = FOCAL / depth
    return {
      x: centerX + lateralM * invZ,
      y: centerY + (camHeightM - verticalM) * invZ,
      depth,
      nearness: invZ / nearInvZ,
    }
  }
}

function edgePath(
  points: ForwardPathPoint[],
  project: (f: number, l: number, v: number) => Projected,
): string {
  // Filled corridor ribbon: left edge outbound, right edge back.
  const left = points.map((p) => project(p.forwardM, p.lateralM - CORRIDOR_HALF_M, p.verticalM))
  const right = points.map((p) => project(p.forwardM, p.lateralM + CORRIDOR_HALF_M, p.verticalM))
  const forward = left.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
  const back = [...right].reverse().map((pt) => `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
  return [...forward, ...back, 'Z'].join(' ')
}

function centerlinePath(
  points: Array<{ x: number, y: number }>,
): string {
  return points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ')
}

export function HudPredictiveTrajectory({ sample, width = 620, height = 620, config }: HudPredictiveTrajectoryProps) {
  if (sample === null) {
    return <div className="hud-orientation-empty">Predictive path unavailable</div>
  }

  const trajectory = config === undefined
    ? resolvePredictiveTrajectory(sample)
    : resolvePredictiveTrajectory(sample, config)
  const attitude = resolveAttitude(sample)
  const rollDeg = attitude.rollDeg ?? 0
  const pitchDeg = attitude.pitchDeg ?? 0
  const centerX = width / 2
  const centerY = height / 2

  // World grid uses a fixed camera height; the flight path's camera height shrinks
  // with nose-down pitch so its start rises above the boresight and recedes down.
  const clampedPitch = clamp(pitchDeg, -PITCH_CLAMP_DEG, PITCH_CLAMP_DEG)
  const pathCamHeightM = PATH_CAM_HEIGHT_M + clampedPitch * PATH_PITCH_CAM_GAIN_M_PER_DEG
  const projectWorld = makeProjector(centerX, centerY, CAM_HEIGHT_M)
  const project = makeProjector(centerX, centerY, pathCamHeightM)

  // World layer rolls WITH the attitude indicator (rotate -roll) and pitches like
  // it; the flight-path layer banks the OPPOSITE way (rotate +roll) so a right
  // bank starts the corridor left of boresight and sweeps it out to the right.
  const worldPitchPx = clampedPitch * WORLD_PITCH_PX_PER_DEG
  const worldTransform = `rotate(${(-rollDeg).toFixed(2)} ${centerX} ${centerY}) translate(0 ${worldPitchPx.toFixed(1)})`
  const pathTransform = `rotate(${rollDeg.toFixed(2)} ${centerX} ${centerY})`

  // Only draw the corridor while it keeps advancing ahead of the nose. Once a
  // hard turn carries the path abeam (forward depth stops growing), stop — past
  // that point a forward camera can't meaningfully show it.
  const allForward = trajectory.forwardPoints
  let cut = allForward.length
  for (let i = 2; i < allForward.length; i += 1) {
    if (allForward[i].forwardM <= allForward[i - 1].forwardM) {
      cut = i
      break
    }
  }
  const fwd = allForward.slice(0, Math.max(2, cut))
  const centerline = fwd.map((p) => project(p.forwardM, p.lateralM, p.verticalM))
  const endPoint = centerline.at(-1) ?? { x: centerX, y: centerY, depth: NEAR_M, nearness: 1 }
  const prevPoint = centerline.at(-2) ?? endPoint

  // Depth rungs across the corridor at 1-second gates — the primary depth cue.
  const gateStep = Math.max(1, Math.round(1 / (fwd[1]?.tSec ?? 0.25)))
  const rungs = fwd
    .map((p, index) => ({ p, index }))
    .filter(({ index }) => index > 0 && index % gateStep === 0)
    .map(({ p }) => ({
      left: project(p.forwardM, p.lateralM - CORRIDOR_HALF_M, p.verticalM),
      right: project(p.forwardM, p.lateralM + CORRIDOR_HALF_M, p.verticalM),
      tSec: p.tSec,
    }))

  // Ribbon segments, each colored by the sign of its climb: a rising stretch
  // shows the TOP surface (sky), a falling stretch shows the BOTTOM (ground). The
  // color only flips at a real crest/trough, so a steady climb is one solid hue.
  const CLIMB_EPS = 0.02
  const ribbonQuads = fwd.slice(0, -1).map((a, i) => {
    const b = fwd[i + 1]
    const lA = project(a.forwardM, a.lateralM - CORRIDOR_HALF_M, a.verticalM)
    const lB = project(b.forwardM, b.lateralM - CORRIDOR_HALF_M, b.verticalM)
    const rB = project(b.forwardM, b.lateralM + CORRIDOR_HALF_M, b.verticalM)
    const rA = project(a.forwardM, a.lateralM + CORRIDOR_HALF_M, a.verticalM)
    const dv = b.verticalM - a.verticalM
    const color = dv > CLIMB_EPS ? PATH_SKY_COLOR : dv < -CLIMB_EPS ? PATH_GROUND_COLOR : PATH_LEVEL_COLOR
    const nearness = (lA.nearness + lB.nearness) / 2
    return {
      points: `${lA.x.toFixed(1)},${lA.y.toFixed(1)} ${lB.x.toFixed(1)},${lB.y.toFixed(1)} ${rB.x.toFixed(1)},${rB.y.toFixed(1)} ${rA.x.toFixed(1)},${rA.y.toFixed(1)}`,
      color,
      opacity: 0.12 + nearness * 0.42,
    }
  })

  // Centerline as fading segments — its strength diminishes toward the far end.
  const centerSegs = centerline.slice(0, -1).map((p, i) => {
    const q = centerline[i + 1]
    const nearness = (p.nearness + q.nearness) / 2
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, opacity: 0.14 + nearness * 0.7, width: 1 + nearness * 1.5 }
  })

  // Arrowhead at the far end, oriented along the corridor's vanishing tangent. Its
  // strength diminishes as the drawn path grows longer, so it fades on long shots.
  const pathLengthPx = centerline
    .slice(0, -1)
    .reduce((sum, p, i) => sum + Math.hypot(centerline[i + 1].x - p.x, centerline[i + 1].y - p.y), 0)
  const arrowStrength = clamp(0.8 - pathLengthPx / 700, 0.12, 0.8)
  const tipAngle = Math.atan2(endPoint.y - prevPoint.y, endPoint.x - prevPoint.x)
  const arrowLength = 8 + endPoint.nearness * 6
  const arrowSpread = 0.5
  const arrowLeft = {
    x: endPoint.x - Math.cos(tipAngle - arrowSpread) * arrowLength,
    y: endPoint.y - Math.sin(tipAngle - arrowSpread) * arrowLength,
  }
  const arrowRight = {
    x: endPoint.x - Math.cos(tipAngle + arrowSpread) * arrowLength,
    y: endPoint.y - Math.sin(tipAngle + arrowSpread) * arrowLength,
  }

  const deltaMagnitude = Math.abs(trajectory.headingTrackDeltaDeg)
  const deltaDirection = trajectory.headingTrackDeltaDeg > 0 ? 'RIGHT' : trajectory.headingTrackDeltaDeg < 0 ? 'LEFT' : 'CENTER'
  const deltaColorClass = trajectory.headingTrackDeltaDeg > 0 ? 'hud-trajectory-delta-positive' : trajectory.headingTrackDeltaDeg < 0 ? 'hud-trajectory-delta-negative' : 'hud-trajectory-delta-neutral'

  // Horizon reference: the vanishing point / level line at frame center.
  const horizonY = centerY

  return (
    <svg className="hud-trajectory" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Predictive trajectory corridor">
      <rect x={0} y={0} width={width} height={height} className="hud-trajectory-bg" rx={10} ry={10} />

      {/* World layer — grid + horizon, rolls like the attitude indicator (−roll) */}
      <g transform={worldTransform}>
        <g className="hud-trajectory-grid-group">
          {[-3, -1.5, 0, 1.5, 3].map((lane) => (
            <path
              key={`lane-${lane}`}
              className="hud-trajectory-grid"
              d={centerlinePath([2, 8, 16, 28, 44, 64].map((f) => projectWorld(f, lane * CORRIDOR_HALF_M, 0)))}
            />
          ))}
          {[2, 8, 16, 28, 44, 64].map((f) => {
            const l = projectWorld(f, -3 * CORRIDOR_HALF_M, 0)
            const r = projectWorld(f, 3 * CORRIDOR_HALF_M, 0)
            return <line key={`depth-${f}`} className="hud-trajectory-grid" x1={l.x} y1={l.y} x2={r.x} y2={r.y} />
          })}
        </g>
        <line x1={centerX - width} y1={horizonY} x2={centerX + width} y2={horizonY} className="hud-trajectory-horizon" />
      </g>

      {/* Flight-path layer — banks OPPOSITE the world (+roll); pitch is baked into
          its camera height, so it points where the nose is predicted to go. */}
      <g transform={pathTransform}>
        {/* Flight-path corridor surface — per-segment: sky when rising, ground when
            falling, so the visible face reads by the path's actual vertical slope. */}
        {ribbonQuads.map((quad, index) => (
          <polygon key={`ribbon-${index}`} points={quad.points} fill={quad.color} fillOpacity={quad.opacity} stroke="none" />
        ))}
        <path className="hud-trajectory-corridor" d={edgePath(fwd, project)} fill="none" />

        {/* Depth gates */}
        {rungs.map((rung, index) => (
          <line
            key={`rung-${index}`}
            x1={rung.left.x}
            y1={rung.left.y}
            x2={rung.right.x}
            y2={rung.right.y}
            className="hud-trajectory-gate"
            style={{ opacity: 0.25 + rung.left.nearness * 0.6 }}
          />
        ))}

        {/* Corridor centerline — strength fades toward the far end */}
        {centerSegs.map((seg, index) => (
          <line
            key={`center-${index}`}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            className="hud-trajectory-path"
            style={{ opacity: trajectory.isStalled ? seg.opacity * 0.6 : seg.opacity, strokeWidth: seg.width }}
          />
        ))}

        {/* Far endpoint + arrowhead — strength diminishes with drawn path length */}
        <line x1={arrowLeft.x} y1={arrowLeft.y} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-tip" style={{ opacity: arrowStrength }} />
        <line x1={arrowRight.x} y1={arrowRight.y} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-tip" style={{ opacity: arrowStrength }} />
        <circle cx={endPoint.x} cy={endPoint.y} r={2.5 + endPoint.nearness * 1.5} className="hud-trajectory-end" style={{ opacity: 0.3 + arrowStrength * 0.7 }} />

        {/* Aircraft-now marker at the near field (the corridor "start") */}
        <circle cx={centerline[0].x} cy={centerline[0].y} r={5} className="hud-trajectory-origin" />
      </g>

      {/* Fixed boresight cross — the airframe nose reference the world rolls around */}
      <g className="hud-trajectory-boresight">
        <line x1={centerX - 16} y1={centerY} x2={centerX - 6} y2={centerY} />
        <line x1={centerX + 6} y1={centerY} x2={centerX + 16} y2={centerY} />
        <line x1={centerX} y1={centerY - 16} x2={centerX} y2={centerY - 6} />
        <line x1={centerX} y1={centerY + 6} x2={centerX} y2={centerY + 16} />
        <circle cx={centerX} cy={centerY} r={2.6} />
      </g>

      <text x={18} y={24} className="hud-trajectory-label">STALL {trajectory.stallSpeedMps.toFixed(1)} m/s</text>
      <text x={18} y={42} className="hud-trajectory-label">SPD {trajectory.speedMps.toFixed(1)} m/s</text>
      <text x={18} y={60} className="hud-trajectory-label">TURN {trajectory.turnRateRadPerSec.toFixed(2)} rad/s</text>
      <text x={18} y={78} className="hud-trajectory-label">CLIMB {trajectory.verticalRateMps.toFixed(1)} m/s</text>
      <text x={18} y={96} className="hud-trajectory-label">HDG {trajectory.headingDeg === null ? 'N/A' : trajectory.headingDeg.toFixed(0)}</text>
      <text x={18} y={114} className="hud-trajectory-label">TRK {trajectory.trackDeg === null ? 'N/A' : trajectory.trackDeg.toFixed(0)}</text>
      <text x={18} y={132} className="hud-trajectory-label">DRIFT {trajectory.driftDeg.toFixed(1)}°</text>
      <text x={18} y={150} className={`hud-trajectory-label ${deltaColorClass}`}>
        Δ {deltaMagnitude.toFixed(1)}° {deltaDirection}
      </text>

      <text x={width - 18} y={24} textAnchor="end" className="hud-trajectory-hint">
        Cockpit view — ground rolls with attitude; flight path banks into the turn
      </text>

      {trajectory.isStalled ? (
        <text x={centerX} y={height - 20} textAnchor="middle" className="hud-trajectory-stall-label">
          BELOW STALL
        </text>
      ) : null}
    </svg>
  )
}
