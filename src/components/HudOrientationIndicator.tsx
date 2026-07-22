function normalizeDegrees(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Vec2 {
  x: number
  y: number
}

function rotateX(point: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return {
    x: point.x,
    y: point.y * c - point.z * s,
    z: point.y * s + point.z * c,
  }
}

function rotateY(point: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return {
    x: point.x * c + point.z * s,
    y: point.y,
    z: -point.x * s + point.z * c,
  }
}

function rotateZ(point: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
    z: point.z,
  }
}

function applyAttitude(point: Vec3, rollRad: number, pitchRad: number, yawRad: number): Vec3 {
  // Aircraft convention: roll around X, pitch around Y, yaw around Z.
  return rotateZ(rotateY(rotateX(point, rollRad), pitchRad), yawRad)
}

function projectTo2d(point: Vec3, center: number, focalLength: number): Vec2 {
  const depth = point.z + 140
  const scale = focalLength / Math.max(70, depth)
  return {
    x: center + point.x * scale,
    y: center - point.y * scale,
  }
}

function pointsToPolyline(points: Vec2[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

export interface HudOrientationIndicatorProps {
  rollDeg: number | null
  pitchDeg: number | null
  yawDeg: number | null
  width?: number
  height?: number
}

export function HudOrientationIndicator({
  rollDeg,
  pitchDeg,
  yawDeg,
  width = 420,
  height = 330,
}: HudOrientationIndicatorProps) {
  if (rollDeg === null || pitchDeg === null || yawDeg === null) {
    return <div className="hud-orientation-empty">Orientation unavailable</div>
  }

  const viewMin = Math.min(width, height)
  const radius = viewMin / 2
  const centerX = width / 2
  const centerY = height / 2
  const wrappedYaw = normalizeDegrees(yawDeg)

  const rollRad = (rollDeg * Math.PI) / 180
  const pitchRad = (pitchDeg * Math.PI) / 180
  const yawRad = (wrappedYaw * Math.PI) / 180

  const focalLength = 250
  const modelScale = 2.8

  const vehicleVertices: Record<string, Vec3> = {
    nose: { x: 0, y: 30 * modelScale, z: 10 * modelScale },
    tail: { x: 0, y: -24 * modelScale, z: 10 * modelScale },
    leftWing: { x: -28 * modelScale, y: 2 * modelScale, z: 8 * modelScale },
    rightWing: { x: 28 * modelScale, y: 2 * modelScale, z: 8 * modelScale },
    top: { x: 0, y: 0, z: 24 * modelScale },
    bottom: { x: 0, y: 0, z: -10 * modelScale },
  }

  const transformed = Object.fromEntries(
    Object.entries(vehicleVertices).map(([key, vertex]) => {
      const rotated = applyAttitude(vertex, rollRad, pitchRad, yawRad)
      const projected = projectTo2d(rotated, radius, focalLength)
      return [key, { x: projected.x + (centerX - radius), y: projected.y + (centerY - radius) }]
    }),
  ) as Record<keyof typeof vehicleVertices, Vec2>

  const axisLength = 105
  const axisEnds = {
    x: projectTo2d(applyAttitude({ x: axisLength, y: 0, z: 0 }, rollRad, pitchRad, yawRad), radius, focalLength),
    y: projectTo2d(applyAttitude({ x: 0, y: axisLength, z: 0 }, rollRad, pitchRad, yawRad), radius, focalLength),
    z: projectTo2d(applyAttitude({ x: 0, y: 0, z: axisLength }, rollRad, pitchRad, yawRad), radius, focalLength),
  }

  const bodyDown = projectTo2d(
    applyAttitude({ x: 0, y: 0, z: -axisLength }, rollRad, pitchRad, yawRad),
    radius,
    focalLength,
  )

  const axisProjected = {
    x: { x: axisEnds.x.x + (centerX - radius), y: axisEnds.x.y + (centerY - radius) },
    y: { x: axisEnds.y.x + (centerX - radius), y: axisEnds.y.y + (centerY - radius) },
    z: { x: axisEnds.z.x + (centerX - radius), y: axisEnds.z.y + (centerY - radius) },
    down: { x: bodyDown.x + (centerX - radius), y: bodyDown.y + (centerY - radius) },
  }

  const centerPoint = { x: centerX, y: centerY }

  const ringRadius = radius - 18
  const frameLeft = centerX - ringRadius
  const frameTop = centerY - ringRadius
  const frameSize = ringRadius * 2

  return (
    <svg className="hud-orientation" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Vehicle orientation indicator">
      <rect x={0} y={0} width={width} height={height} className="hud-orientation-bg" rx={10} ry={10} />

      <rect x={frameLeft} y={frameTop} width={frameSize} height={frameSize / 2} className="hud-world-sky" rx={6} ry={6} />
      <rect x={frameLeft} y={centerY} width={frameSize} height={frameSize / 2} className="hud-world-ground" rx={0} ry={0} />
      <circle cx={centerX} cy={centerY} r={ringRadius} className="hud-orientation-ring" />
      <line x1={frameLeft} y1={centerY} x2={frameLeft + frameSize} y2={centerY} className="hud-world-level" />
      <line x1={centerX} y1={frameTop - 4} x2={centerX} y2={frameTop + frameSize + 4} className="hud-orientation-axis" />
      <line x1={frameLeft - 4} y1={centerY} x2={frameLeft + frameSize + 4} y2={centerY} className="hud-orientation-axis" />
      <text x={centerX} y={frameTop + 12} textAnchor="middle" className="hud-world-label">N</text>
      <text x={centerX} y={frameTop + frameSize - 8} textAnchor="middle" className="hud-world-label">S</text>
      <text x={frameLeft + 8} y={centerY - 6} className="hud-world-label">W</text>
      <text x={frameLeft + frameSize - 8} y={centerY - 6} textAnchor="end" className="hud-world-label">E</text>

      <line x1={centerPoint.x} y1={centerPoint.y} x2={axisProjected.x.x} y2={axisProjected.x.y} className="hud-axis-x" />
      <line x1={centerPoint.x} y1={centerPoint.y} x2={axisProjected.y.x} y2={axisProjected.y.y} className="hud-axis-y" />
      <line x1={centerPoint.x} y1={centerPoint.y} x2={axisProjected.z.x} y2={axisProjected.z.y} className="hud-axis-z" />
      <line x1={centerPoint.x} y1={centerPoint.y} x2={axisProjected.down.x} y2={axisProjected.down.y} className="hud-axis-down" />

      <text x={axisProjected.x.x + 3} y={axisProjected.x.y + 3} className="hud-axis-label">X</text>
      <text x={axisProjected.y.x + 3} y={axisProjected.y.y + 3} className="hud-axis-label">Y</text>
      <text x={axisProjected.z.x + 3} y={axisProjected.z.y + 3} className="hud-axis-label">Z</text>
      <text x={axisProjected.down.x + 4} y={axisProjected.down.y + 4} className="hud-axis-label">D</text>

      <polyline
        className="hud-vehicle-edge"
        points={pointsToPolyline([
          transformed.leftWing,
          transformed.nose,
          transformed.rightWing,
          transformed.tail,
          transformed.leftWing,
        ])}
      />
      <line x1={transformed.nose.x} y1={transformed.nose.y} x2={transformed.top.x} y2={transformed.top.y} className="hud-vehicle-edge" />
      <line x1={transformed.tail.x} y1={transformed.tail.y} x2={transformed.bottom.x} y2={transformed.bottom.y} className="hud-vehicle-edge-dim" />
      <line x1={transformed.top.x} y1={transformed.top.y} x2={transformed.bottom.x} y2={transformed.bottom.y} className="hud-vehicle-edge-dim" />
      <circle cx={transformed.nose.x} cy={transformed.nose.y} r={2.8} className="hud-orientation-nose" />

      <text x={centerX} y={18} className="hud-orientation-heading" textAnchor="middle">
        HDG {Math.round(wrappedYaw).toString().padStart(3, '0')}
      </text>
      <text x={12} y={height - 12} className="hud-orientation-text">
        P {pitchDeg.toFixed(1)}
      </text>
      <text x={width - 12} y={height - 12} textAnchor="end" className="hud-orientation-text">
        R {rollDeg.toFixed(1)}
      </text>
    </svg>
  )
}
