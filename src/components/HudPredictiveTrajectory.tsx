import { resolvePredictiveTrajectory } from '../logic/trajectory'
import type { ForwardPathPoint } from '../logic/trajectory'
import type { TelemetrySample } from '../logic/telemetry'

interface HudPredictiveTrajectoryProps {
  sample: TelemetrySample | null
  width?: number
  height?: number
}

// Forward-looking perspective camera, sitting slightly ABOVE the flight path so
// the near future drops to the bottom of the frame and recedes up to a
// vanishing point at center — a "road to the horizon" for the flight path.
const FOCAL = 240 // px·m — larger = tighter/longer corridor
const NEAR_M = 6 // depth of the aircraft-now plane (avoids divide-by-zero)
const MIN_DEPTH_M = 1.2 // clamp so hard turns can't wrap behind the camera
const CAM_HEIGHT_M = 3.6 // eye height above the path — controls near-field drop
const CORRIDOR_HALF_M = 3.0 // corridor half-width in meters

interface Projected {
  x: number
  y: number
  depth: number
  nearness: number // 1 at the near plane → 0 far away, for width/opacity cues
}

function makeProjector(centerX: number, centerY: number) {
  const nearInvZ = FOCAL / NEAR_M
  return function project(forwardM: number, lateralM: number, verticalM: number): Projected {
    const depth = Math.max(MIN_DEPTH_M, forwardM + NEAR_M)
    const invZ = FOCAL / depth
    return {
      x: centerX + lateralM * invZ,
      y: centerY + (CAM_HEIGHT_M - verticalM) * invZ,
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

export function HudPredictiveTrajectory({ sample, width = 620, height = 620 }: HudPredictiveTrajectoryProps) {
  if (sample === null) {
    return <div className="hud-orientation-empty">Predictive path unavailable</div>
  }

  const trajectory = resolvePredictiveTrajectory(sample)
  const centerX = width / 2
  const centerY = height / 2
  const project = makeProjector(centerX, centerY)

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

  // Arrowhead at the far end, oriented along the corridor's vanishing tangent.
  const tipAngle = Math.atan2(endPoint.y - prevPoint.y, endPoint.x - prevPoint.x)
  const arrowLength = 16 + endPoint.nearness * 20
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

      <defs>
        <linearGradient id="corridorFade" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#89d0ff" stopOpacity="0.34" />
          <stop offset="55%" stopColor="#89d0ff" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#89d0ff" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Perspective floor grid converging on the vanishing point */}
      <g className="hud-trajectory-grid-group">
        {[-3, -1.5, 0, 1.5, 3].map((lane) => (
          <path
            key={`lane-${lane}`}
            className="hud-trajectory-grid"
            d={centerlinePath([2, 8, 16, 28, 44, 64].map((f) => project(f, lane * CORRIDOR_HALF_M, 0)))}
          />
        ))}
        {[2, 8, 16, 28, 44, 64].map((f) => {
          const l = project(f, -3 * CORRIDOR_HALF_M, 0)
          const r = project(f, 3 * CORRIDOR_HALF_M, 0)
          return <line key={`depth-${f}`} className="hud-trajectory-grid" x1={l.x} y1={l.y} x2={r.x} y2={r.y} />
        })}
      </g>

      <line x1={0} y1={horizonY} x2={width} y2={horizonY} className="hud-trajectory-axis" />
      <line x1={centerX} y1={horizonY - 60} x2={centerX} y2={height} className="hud-trajectory-axis" />

      {/* Flight-path corridor ribbon (near = wide/bright, far = narrow/faint) */}
      <path
        className={trajectory.isStalled ? 'hud-trajectory-corridor hud-trajectory-stall-fill' : 'hud-trajectory-corridor'}
        d={edgePath(fwd, project)}
        fill="url(#corridorFade)"
      />

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

      {/* Corridor centerline */}
      <path className="hud-trajectory-path" d={centerlinePath(centerline)} style={{ opacity: trajectory.isStalled ? 0.6 : 0.95 }} />

      {/* Far endpoint + vanishing-tangent arrowhead */}
      <line x1={arrowLeft.x} y1={arrowLeft.y} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-tip" />
      <line x1={arrowRight.x} y1={arrowRight.y} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-tip" />
      <circle cx={endPoint.x} cy={endPoint.y} r={3 + endPoint.nearness * 3} className="hud-trajectory-end" />

      {/* Vanishing point / horizon marker at center */}
      <circle cx={centerX} cy={horizonY} r={7} className="hud-trajectory-vanish" />
      <circle cx={centerX} cy={horizonY} r={2.4} className="hud-trajectory-vanish-core" />

      {/* Aircraft-now marker at the near field */}
      <circle cx={centerline[0].x} cy={centerline[0].y} r={5} className="hud-trajectory-origin" />

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
        Perspective corridor — path recedes toward the horizon at center
      </text>

      {trajectory.isStalled ? (
        <text x={centerX} y={height - 20} textAnchor="middle" className="hud-trajectory-stall-label">
          BELOW STALL
        </text>
      ) : null}
    </svg>
  )
}
