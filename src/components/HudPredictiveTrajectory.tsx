import { resolvePredictiveTrajectory } from '../logic/trajectory'
import type { TelemetrySample } from '../logic/telemetry'

interface HudPredictiveTrajectoryProps {
  sample: TelemetrySample | null
  width?: number
  height?: number
}

function pointsToPathData(points: Array<{ x: number, y: number }>): string {
  if (points.length === 0) {
    return ''
  }

  const [first, ...rest] = points
  return [`M ${first.x} ${first.y}`, ...rest.map((point) => `L ${point.x} ${point.y}`)].join(' ')
}

export function HudPredictiveTrajectory({ sample, width = 620, height = 620 }: HudPredictiveTrajectoryProps) {
  if (sample === null) {
    return <div className="hud-orientation-empty">Predictive path unavailable</div>
  }

  const trajectory = resolvePredictiveTrajectory(sample)
  const centerX = width / 2
  const centerY = height / 2

  const maxExtent = Math.max(12, ...trajectory.points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))))

  const scale = Math.min(width, height) * 0.40 / maxExtent
  const svgPoints = trajectory.points.map((point) => ({
    x: centerX - point.x * scale,
    y: centerY + point.y * scale,
  }))

  const endPoint = svgPoints.at(-1) ?? { x: centerX, y: centerY }
  const prevPoint = svgPoints.at(-2) ?? { x: centerX, y: centerY }
  const isNearlyStraight = Math.abs(trajectory.turnRateRadPerSec) < 0.05 && Math.abs(trajectory.verticalRateMps) < 1.2
  const showDotOnly = trajectory.isStalled || (isNearlyStraight && maxExtent < 16)
  const pathOpacity = trajectory.isStalled ? 0.75 : 0.95
  const deltaMagnitude = Math.abs(trajectory.headingTrackDeltaDeg)
  const deltaDirection = trajectory.headingTrackDeltaDeg > 0 ? 'RIGHT' : trajectory.headingTrackDeltaDeg < 0 ? 'LEFT' : 'CENTER'
  const deltaColorClass = trajectory.headingTrackDeltaDeg > 0 ? 'hud-trajectory-delta-positive' : trajectory.headingTrackDeltaDeg < 0 ? 'hud-trajectory-delta-negative' : 'hud-trajectory-delta-neutral'

  const tipAngle = Math.atan2(endPoint.y - prevPoint.y, endPoint.x - prevPoint.x)
  const arrowLength = showDotOnly ? 26 : 34
  const arrowSpread = 0.42
  const arrowLeft = {
    x: endPoint.x - Math.cos(tipAngle - arrowSpread) * arrowLength,
    y: endPoint.y - Math.sin(tipAngle - arrowSpread) * arrowLength,
  }
  const arrowRight = {
    x: endPoint.x - Math.cos(tipAngle + arrowSpread) * arrowLength,
    y: endPoint.y - Math.sin(tipAngle + arrowSpread) * arrowLength,
  }

  return (
    <svg className="hud-trajectory" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Predictive trajectory path">
      <rect x={0} y={0} width={width} height={height} className="hud-trajectory-bg" rx={10} ry={10} />
      <g opacity={0.35}>
        {Array.from({ length: 7 }, (_, index) => centerY - 180 + index * 60).map((y) => (
          <line key={y} x1={32} y1={y} x2={width - 32} y2={y} className="hud-trajectory-grid" />
        ))}
        {Array.from({ length: 7 }, (_, index) => centerX - 180 + index * 60).map((x) => (
          <line key={x} x1={x} y1={32} x2={x} y2={height - 32} className="hud-trajectory-grid" />
        ))}
      </g>

      <line x1={0} y1={centerY} x2={width} y2={centerY} className="hud-trajectory-axis" />
      <line x1={centerX} y1={0} x2={centerX} y2={height} className="hud-trajectory-axis" />
      <circle cx={centerX} cy={centerY} r={6} className="hud-trajectory-origin" />

      {showDotOnly ? null : (
        <path
          className={trajectory.isStalled ? 'hud-trajectory-path hud-trajectory-stall' : 'hud-trajectory-path'}
          d={pointsToPathData(svgPoints)}
          style={{ opacity: pathOpacity }}
        />
      )}
      <line x1={arrowLeft.x} y1={arrowLeft.y} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-tip" />
      <line x1={arrowRight.x} y1={arrowRight.y} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-tip" />
      <circle cx={endPoint.x} cy={endPoint.y} r={showDotOnly ? 8 : isNearlyStraight ? 5 : 7} className="hud-trajectory-end" />
      <circle cx={endPoint.x} cy={endPoint.y} r={showDotOnly ? 2.8 : 3.5} className="hud-trajectory-core" />

      {svgPoints.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}-${index}`}
          cx={point.x}
          cy={point.y}
          r={index === 0 ? 3 : index === svgPoints.length - 1 ? 4 : 2.2}
          className={index === 0 ? 'hud-trajectory-node hud-trajectory-node-origin' : 'hud-trajectory-node'}
        />
      ))}

      <line x1={centerX} y1={centerY} x2={endPoint.x} y2={endPoint.y} className="hud-trajectory-ladder" />

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
        Forward is center; path blends heading, track, bank and pitch
      </text>

      {trajectory.isStalled ? (
        <text x={centerX} y={height - 20} textAnchor="middle" className="hud-trajectory-stall-label">
          BELOW STALL
        </text>
      ) : null}
    </svg>
  )
}
