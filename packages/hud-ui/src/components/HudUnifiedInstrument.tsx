import { resolveAttitude } from '../logic/attitude'
import type { TelemetrySample } from '../logic/telemetry'
import type { ForwardPathPoint, TrajectoryConfig } from '../logic/trajectory'
import { isCoordinationNominal, resolveCoordinationDirection, resolveCoordinationLabel, resolvePredictiveTrajectory } from '../logic/trajectory'

interface HudUnifiedInstrumentProps {
  sample: TelemetrySample | null
  width?: number
  height?: number
  /** Overrides the trajectory integrator config (e.g. a playground stall speed). */
  config?: TrajectoryConfig
  profile?: 'default' | 'micro' | 'portrait'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Shared with HudAttitudeIndicator / HudPredictiveTrajectory — this is the
// merge point, so the two source instruments' constants have to agree for
// the ladder and the world grid to pitch/roll in lockstep.
const WORLD_PITCH_PX_PER_DEG = 6
const PITCH_CLAMP_DEG = 30
const PATH_PITCH_CAM_GAIN_M_PER_DEG = 0.28

const FOCAL = 240
const NEAR_M = 6
const MIN_DEPTH_M = 1.2
const CAM_HEIGHT_M = 3.6
const PATH_CAM_HEIGHT_M = 2.3
const CORRIDOR_HALF_M = 3.0

const PATH_SKY_COLOR = '#79d2ff'
const PATH_GROUND_COLOR = '#f0a24e'
const PATH_LEVEL_COLOR = '#6f88a3'

const LADDER_STEPS_DEG = [-30, -20, -10, 10, 20, 30]
const LADDER_MINOR_STEPS_DEG = [-25, -15, -5, 5, 15, 25]

interface Projected {
  x: number
  y: number
  depth: number
  nearness: number
}

function makeProjector(
  centerX: number,
  centerY: number,
  camHeightM: number,
  focal = FOCAL,
  nearM = NEAR_M,
  minDepthM = MIN_DEPTH_M,
) {
  const nearInvZ = focal / nearM
  return function project(forwardM: number, lateralM: number, verticalM: number): Projected {
    const depth = Math.max(minDepthM, forwardM + nearM)
    const invZ = focal / depth
    return {
      x: centerX + lateralM * invZ,
      y: centerY + (camHeightM - verticalM) * invZ,
      depth,
      nearness: invZ / nearInvZ,
    }
  }
}

function centerlinePath(points: Array<{ x: number, y: number }>): string {
  return points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
}

function edgePath(points: ForwardPathPoint[], project: (f: number, l: number, v: number) => Projected): string {
  const left = points.map((p) => project(p.forwardM, p.lateralM - CORRIDOR_HALF_M, p.verticalM))
  const right = points.map((p) => project(p.forwardM, p.lateralM + CORRIDOR_HALF_M, p.verticalM))
  const forward = left.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
  const back = [...right].reverse().map((pt) => `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
  return [...forward, ...back, 'Z'].join(' ')
}

/**
 * First-pass merge of the attitude/heading indicator and the predictive
 * trajectory instrument: the attitude ladder's pitch rungs + horizon become
 * an overlay riding on the trajectory's perspective ground grid (its
 * "background paradigm") instead of a flat sky/ground fill. Graphics only —
 * every readout except an abnormal stall/coordination call-out is dropped;
 * see HudFlightState for the numeric version of this same data.
 */
export function HudUnifiedInstrument({ sample, width = 820, height = 520, config, profile = 'default' }: HudUnifiedInstrumentProps) {
  if (sample === null) {
    return <div className="hud-orientation-empty">Unified instrument unavailable</div>
  }

  const centerX = width / 2
  const centerY = height / 2
  const isMicro = profile === 'micro' || width <= 80
  const microScale = isMicro ? 0.76 : 1
  const microSceneTransform = `translate(${centerX} ${centerY}) scale(${microScale}) translate(${-centerX} ${-centerY})`
  const globalTrajectoryWidthScale = 0.72
  const globalTrajectoryOpacityScale = 0.86
  const microPathWidthScale = isMicro ? 0.52 : 1
  const microPathOpacityScale = isMicro ? 0.72 : 1
  const microGateStroke = isMicro ? 0.74 : undefined
  const microCoordStroke = isMicro ? 0.85 : undefined
  const microGridStroke = isMicro ? 0.58 : undefined
  const microHorizonStroke = isMicro ? 0.78 : undefined
  const microCorridorStroke = isMicro ? 0.82 : undefined
  const gateStrokeWidth = isMicro ? 0.62 : 0.96
  const corridorStrokeWidth = isMicro ? 0.64 : 0.84
  const focal = isMicro ? 132 : FOCAL
  const nearM = isMicro ? 4.2 : NEAR_M
  const minDepthM = isMicro ? 0.9 : MIN_DEPTH_M

  const trajectory = config === undefined ? resolvePredictiveTrajectory(sample) : resolvePredictiveTrajectory(sample, config)
  const attitude = resolveAttitude(sample)
  const rollDeg = attitude.rollDeg ?? 0
  const pitchDeg = attitude.pitchDeg ?? 0
  const coordination = resolveCoordinationLabel(trajectory.turnRateRadPerSec, trajectory.coordinatedTurnRateRadPerSec)
  const coordinationIsNominal = isCoordinationNominal(coordination)
  const coordinationDirection = resolveCoordinationDirection(trajectory.turnRateRadPerSec, trajectory.coordinatedTurnRateRadPerSec)

  const worldPitchPxPerDeg = isMicro ? 2.5 : WORLD_PITCH_PX_PER_DEG
  const referenceHalfWidth = Math.min(width, height) * (isMicro ? 0.1 : 0.14)
  // Pitch-ladder rungs split around a gap wide enough to clear the flight-path
  // corridor, pushed out toward the sides so the ladder frames the corridor
  // instead of crowding it. Tick length is kept short and independent of that
  // gap — otherwise pushing the gap outward stretches each rung into a long
  // line instead of just relocating a short tick mark.
  const ladderGapPx = width * (isMicro ? 0.18 : 0.17)
  const ladderTickLengthPx = Math.min(width, height) * (isMicro ? 0.045 : 0.07)
  const ladderOuterPx = ladderGapPx + ladderTickLengthPx

  // Vario tape: fixed to the screen, not the rotating world — vertical rate
  // is a scalar instrument reading, not an attitude quantity, so it doesn't
  // roll/pitch with the horizon the way the ladder does.
  const VARIO_RANGE_MPS = 10
  const VARIO_TICK_STEP_MPS = 5
  const varioHalfHeightPx = height * 0.3
  const varioPxPerMps = varioHalfHeightPx / VARIO_RANGE_MPS
  const varioX = width - width * 0.08
  const varioBugY = centerY - clamp(trajectory.verticalRateMps, -VARIO_RANGE_MPS, VARIO_RANGE_MPS) * varioPxPerMps
  const varioTicks: number[] = []
  for (let v = -VARIO_RANGE_MPS; v <= VARIO_RANGE_MPS; v += VARIO_TICK_STEP_MPS) {
    varioTicks.push(v)
  }

  const clampedPitch = clamp(pitchDeg, -PITCH_CLAMP_DEG, PITCH_CLAMP_DEG)
  const pathCamBaseM = isMicro ? 1.05 : PATH_CAM_HEIGHT_M
  const pathCamGain = isMicro ? 0.16 : PATH_PITCH_CAM_GAIN_M_PER_DEG
  const worldCamHeightM = isMicro ? 1.55 : CAM_HEIGHT_M
  const pathCamHeightM = pathCamBaseM + clampedPitch * pathCamGain
  const projectWorld = makeProjector(centerX, centerY, worldCamHeightM, focal, nearM, minDepthM)
  const project = makeProjector(centerX, centerY, pathCamHeightM, focal, nearM, minDepthM)

  const worldPitchPx = clampedPitch * worldPitchPxPerDeg
  const worldTransform = `rotate(${(-rollDeg).toFixed(2)} ${centerX} ${centerY}) translate(0 ${worldPitchPx.toFixed(1)})`
  const pathTransform = `rotate(${rollDeg.toFixed(2)} ${centerX} ${centerY})`

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

  const gateStep = Math.max(1, Math.round(1 / (fwd[1]?.tSec ?? 0.25))) * (isMicro ? 3 : 1)
  const rungs = fwd
    .map((p, index) => ({ p, index }))
    .filter(({ index }) => index > 0 && index % gateStep === 0)
    .map(({ p }) => ({
      left: project(p.forwardM, p.lateralM - CORRIDOR_HALF_M, p.verticalM),
      right: project(p.forwardM, p.lateralM + CORRIDOR_HALF_M, p.verticalM),
    }))

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

  const centerSegs = centerline.slice(0, -1).map((p, i) => {
    const q = centerline[i + 1]
    const nearness = (p.nearness + q.nearness) / 2
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, opacity: 0.14 + nearness * 0.7, width: 1 + nearness * 1.5 }
  })

  const pathLengthPx = centerline
    .slice(0, -1)
    .reduce((sum, p, i) => sum + Math.hypot(centerline[i + 1].x - p.x, centerline[i + 1].y - p.y), 0)
  const arrowStrength = clamp(0.8 - pathLengthPx / 700, 0.12, 0.8)

  const horizonY = centerY
  const coordinationCueY = height - (isMicro ? 8 : 14)
  const coordinationArrowOffset = isMicro ? Math.max(14, width * 0.33) : 74
  const coordinationArrowHalfHeight = isMicro ? 2 : 5
  const coordinationArrowLength = isMicro ? 4 : 11
  const ladderSteps = isMicro ? [-30, -20, -10, 10, 20, 30] : LADDER_STEPS_DEG
  const ladderMinorSteps = isMicro ? [-25, -15, -5, 5, 15, 25] : LADDER_MINOR_STEPS_DEG
  const worldLanes = isMicro ? [-2.2, 0, 2.2] : [-3, -1.5, 0, 1.5, 3]
  const worldDepths = isMicro ? [3, 9, 18, 30] : [2, 8, 16, 28, 44, 64]
  const showLadderLabels = true
  const microLadderLabelStyle = isMicro ? { fontSize: '4px', fontWeight: 600 } : undefined

  return (
    <svg className="hud-unified" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Unified attitude and flight-path instrument">
      <rect x={0} y={0} width={width} height={height} className="hud-trajectory-bg" rx={isMicro ? 0 : 10} ry={isMicro ? 0 : 10} />

      {/* World layer: trajectory's perspective ground grid + horizon, with the
          attitude ladder's pitch rungs riding along on top of it — both roll
          opposite the airframe (-roll) and shift by pitch as one unit. */}
      <g transform={microSceneTransform}>
      <g transform={worldTransform}>
        <g className="hud-trajectory-grid-group">
          {worldLanes.map((lane) => (
            <path
              key={`lane-${lane}`}
              className="hud-trajectory-grid"
              d={centerlinePath(worldDepths.map((f) => projectWorld(f, lane * CORRIDOR_HALF_M, 0)))}
              style={microGridStroke === undefined ? undefined : { strokeWidth: microGridStroke }}
            />
          ))}
          {worldDepths.map((f) => {
            const l = projectWorld(f, worldLanes[0] * CORRIDOR_HALF_M, 0)
            const r = projectWorld(f, worldLanes[worldLanes.length - 1] * CORRIDOR_HALF_M, 0)
            return <line key={`depth-${f}`} className="hud-trajectory-grid" x1={l.x} y1={l.y} x2={r.x} y2={r.y} style={microGridStroke === undefined ? undefined : { strokeWidth: microGridStroke }} />
          })}
        </g>
        <line x1={centerX - width} y1={horizonY} x2={centerX + width} y2={horizonY} className="hud-trajectory-horizon" style={microHorizonStroke === undefined ? undefined : { strokeWidth: microHorizonStroke }} />
        {ladderSteps.map((step) => {
          const y = centerY - step * worldPitchPxPerDeg
          const label = Math.abs(step)
          return (
            <g key={step}>
              <line x1={centerX - ladderOuterPx} y1={y} x2={centerX - ladderGapPx} y2={y} className="hud-ladder" style={microGridStroke === undefined ? undefined : { strokeWidth: microGridStroke }} />
              <line x1={centerX + ladderGapPx} y1={y} x2={centerX + ladderOuterPx} y2={y} className="hud-ladder" style={microGridStroke === undefined ? undefined : { strokeWidth: microGridStroke }} />
              {showLadderLabels ? <text x={centerX - ladderOuterPx - (isMicro ? 2 : 6)} y={y + 3} textAnchor="end" className="hud-ladder-label" style={microLadderLabelStyle}>{label}</text> : null}
              {showLadderLabels ? <text x={centerX + ladderOuterPx + (isMicro ? 2 : 6)} y={y + 3} textAnchor="start" className="hud-ladder-label" style={microLadderLabelStyle}>{label}</text> : null}
            </g>
          )
        })}
        {ladderMinorSteps.map((step) => {
          const y = centerY - step * worldPitchPxPerDeg
          const label = Math.abs(step)
          const minorOuterPx = ladderGapPx + ladderTickLengthPx * 0.5
          return (
            <g key={step}>
              <line x1={centerX - minorOuterPx} y1={y} x2={centerX - ladderGapPx} y2={y} className="hud-ladder" style={microGridStroke === undefined ? undefined : { strokeWidth: microGridStroke }} />
              <line x1={centerX + ladderGapPx} y1={y} x2={centerX + minorOuterPx} y2={y} className="hud-ladder" style={microGridStroke === undefined ? undefined : { strokeWidth: microGridStroke }} />
              {showLadderLabels ? <text x={centerX - minorOuterPx - (isMicro ? 2 : 6)} y={y + 3} textAnchor="end" className="hud-ladder-label" style={microLadderLabelStyle}>{label}</text> : null}
              {showLadderLabels ? <text x={centerX + minorOuterPx + (isMicro ? 2 : 6)} y={y + 3} textAnchor="start" className="hud-ladder-label" style={microLadderLabelStyle}>{label}</text> : null}
            </g>
          )
        })}
      </g>
      </g>

      {/* Flight-path layer: the predictive corridor, banking the opposite way
          (+roll) so it points where the nose is actually headed. */}
      <g transform={microSceneTransform}>
      <g transform={pathTransform}>
        {(isMicro ? ribbonQuads.slice(0, Math.max(1, Math.floor(ribbonQuads.length * 0.6))) : ribbonQuads).map((quad, index) => (
          <polygon key={`ribbon-${index}`} points={quad.points} fill={quad.color} fillOpacity={quad.opacity} stroke="none" />
        ))}
        <path
          className="hud-trajectory-corridor"
          d={edgePath(fwd, project)}
          fill="none"
          style={{
            strokeWidth: corridorStrokeWidth,
            strokeOpacity: 0.3 * globalTrajectoryOpacityScale * microPathOpacityScale,
            ...(microCorridorStroke === undefined ? {} : { strokeWidth: microCorridorStroke }),
          }}
        />
        {rungs.map((rung, index) => (
          <line
            key={`rung-${index}`}
            x1={rung.left.x}
            y1={rung.left.y}
            x2={rung.right.x}
            y2={rung.right.y}
            className="hud-trajectory-gate"
            style={{
              opacity: (0.25 + rung.left.nearness * 0.6) * globalTrajectoryOpacityScale * microPathOpacityScale,
              strokeWidth: gateStrokeWidth,
              ...(microGateStroke === undefined ? {} : { strokeWidth: microGateStroke }),
            }}
          />
        ))}
        {centerSegs.map((seg, index) => (
          <line
            key={`center-${index}`}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            className="hud-trajectory-path"
            style={{
              opacity: (trajectory.isStalled ? seg.opacity * 0.6 : seg.opacity) * globalTrajectoryOpacityScale * microPathOpacityScale,
              strokeWidth: seg.width * globalTrajectoryWidthScale * microPathWidthScale,
            }}
          />
        ))}
        <circle
          cx={endPoint.x}
          cy={endPoint.y}
          r={(2.5 + endPoint.nearness * 1.5) * (isMicro ? 0.5 : 0.72)}
          className="hud-trajectory-end"
          style={{ opacity: (0.3 + arrowStrength * 0.7) * globalTrajectoryOpacityScale * microPathOpacityScale }}
        />
        {isMicro ? null : <circle cx={centerline[0].x} cy={centerline[0].y} r={5} className="hud-trajectory-origin" />}
      </g>
      </g>

      {/* Fixed airframe reference — from the attitude indicator, doesn't rotate */}
      <g transform={`${microSceneTransform} translate(${centerX}, ${centerY})`}>
        <line x1={-referenceHalfWidth} y1={0} x2={-referenceHalfWidth * 0.24} y2={0} className="hud-aircraft" style={microCoordStroke === undefined ? undefined : { strokeWidth: microCoordStroke }} />
        <line x1={referenceHalfWidth * 0.24} y1={0} x2={referenceHalfWidth} y2={0} className="hud-aircraft" style={microCoordStroke === undefined ? undefined : { strokeWidth: microCoordStroke }} />
        <path
          d={`M ${-referenceHalfWidth * 0.24} 0 L ${-referenceHalfWidth * 0.1} ${referenceHalfWidth * 0.17} L ${referenceHalfWidth * 0.1} ${referenceHalfWidth * 0.17} L ${referenceHalfWidth * 0.24} 0`}
          className="hud-aircraft"
          fill="none"
          style={microCoordStroke === undefined ? undefined : { strokeWidth: microCoordStroke }}
        />
      </g>

      {/* Vario tape — plain scale + bug, screen-fixed like the airframe reference */}
      {isMicro ? null : (
        <g className="hud-unified-vario">
          <line x1={varioX} y1={centerY - varioHalfHeightPx} x2={varioX} y2={centerY + varioHalfHeightPx} className="hud-ladder" />
          {varioTicks.map((v) => {
            const y = centerY - v * varioPxPerMps
            const tickHalf = v === 0 ? 9 : 5
            return (
              <g key={v}>
                <line x1={varioX - tickHalf} y1={y} x2={varioX + tickHalf} y2={y} className="hud-ladder" />
                {v === 0 ? null : (
                  <text x={varioX + tickHalf + 5} y={y + 3} textAnchor="start" className="hud-ladder-label">{Math.abs(v)}</text>
                )}
              </g>
            )
          })}
          <polygon
            points={`${varioX - 2},${varioBugY} ${varioX - 14},${varioBugY - 6} ${varioX - 14},${varioBugY + 6}`}
            className="hud-center-bug"
          />
        </g>
      )}

      {trajectory.isStalled ? (
        <text
          x={centerX}
          y={height * (isMicro ? 0.18 : 0.24)}
          textAnchor="middle"
          className="hud-unified-stall-text"
          style={isMicro ? { fontSize: `${Math.max(6, Math.round(height * 0.1))}px`, strokeWidth: 1.6 } : undefined}
        >
          STALL
        </text>
      ) : null}

      {coordinationIsNominal ? null : (
        <g>
          <text
            x={centerX}
            y={coordinationCueY}
            textAnchor="middle"
            className="hud-unified-coordination-text"
            style={isMicro ? { fontSize: '4px', strokeWidth: 0.7 } : undefined}
          >
            {coordination.toUpperCase()}
          </text>
          {coordinationDirection === null ? null : (
            <>
              <polygon
                className="hud-unified-coordination-arrow"
                style={isMicro ? { strokeWidth: 0.45 } : undefined}
                points={
                  coordinationDirection === 'left'
                    ? `${centerX - coordinationArrowOffset},${coordinationCueY} ${centerX - coordinationArrowOffset + coordinationArrowLength},${coordinationCueY - coordinationArrowHalfHeight} ${centerX - coordinationArrowOffset + coordinationArrowLength},${coordinationCueY + coordinationArrowHalfHeight}`
                    : `${centerX + coordinationArrowOffset},${coordinationCueY} ${centerX + coordinationArrowOffset - coordinationArrowLength},${coordinationCueY - coordinationArrowHalfHeight} ${centerX + coordinationArrowOffset - coordinationArrowLength},${coordinationCueY + coordinationArrowHalfHeight}`
                }
              />
              {isMicro ? null : (
                <polygon
                  className="hud-unified-coordination-arrow"
                  points={
                    coordinationDirection === 'left'
                      ? `${centerX - coordinationArrowOffset - 14},${coordinationCueY} ${centerX - coordinationArrowOffset - 14 + coordinationArrowLength},${coordinationCueY - coordinationArrowHalfHeight} ${centerX - coordinationArrowOffset - 14 + coordinationArrowLength},${coordinationCueY + coordinationArrowHalfHeight}`
                      : `${centerX + coordinationArrowOffset + 14},${coordinationCueY} ${centerX + coordinationArrowOffset + 14 - coordinationArrowLength},${coordinationCueY - coordinationArrowHalfHeight} ${centerX + coordinationArrowOffset + 14 - coordinationArrowLength},${coordinationCueY + coordinationArrowHalfHeight}`
                  }
                />
              )}
            </>
          )}
        </g>
      )}
    </svg>
  )
}

export default HudUnifiedInstrument
