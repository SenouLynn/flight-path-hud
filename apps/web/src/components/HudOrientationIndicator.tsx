function normalizeDegrees(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Projected {
  x: number
  y: number
  depth: number
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

/**
 * Body frame: +X = nose (forward), +Y = LEFT wing, +Z = up (canopy). Right-handed.
 *
 * Roll is a rotation about the fuselage axis (X), pitch about the wing axis (Y),
 * yaw about the vertical axis (Z). The pitch and yaw signs are negated so the
 * displayed motion matches the telemetry sense in this left-up frame:
 *   +roll  -> right wing drops (right bank)
 *   +pitch -> nose rises
 *   +yaw (increasing heading) -> nose swings clockwise as seen from above
 */
function applyAttitude(point: Vec3, rollRad: number, pitchRad: number, yawRad: number): Vec3 {
  return rotateZ(rotateY(rotateX(point, rollRad), -pitchRad), -yawRad)
}

export interface HudOrientationIndicatorProps {
  rollDeg: number | null
  pitchDeg: number | null
  yawDeg: number | null
  width?: number
  height?: number
}

// Fixed chase camera: look at the vehicle from behind and above.
const CAMERA_ELEVATION_RAD = (58 * Math.PI) / 180
const FOCAL_LENGTH = 430
const CAMERA_DISTANCE = 300
const MODEL_SCALE = 3.0

function makeProjector(centerX: number, centerY: number) {
  const sinE = Math.sin(CAMERA_ELEVATION_RAD)
  const cosE = Math.cos(CAMERA_ELEVATION_RAD)

  // World frame after attitude: +X forward, +Y left, +Z up.
  // Camera basis: screen-right = -Y, screen-up = X·sinE + Z·cosE, depth = X·cosE - Z·sinE.
  return function project(point: Vec3): Projected {
    const screenUp = point.x * sinE + point.z * cosE
    const screenRight = -point.y
    const depth = point.x * cosE - point.z * sinE
    const scale = FOCAL_LENGTH / (CAMERA_DISTANCE + depth)
    return {
      x: centerX + screenRight * scale,
      y: centerY - screenUp * scale,
      depth,
    }
  }
}

// Aircraft planform in body units (nose +X, left +Y, up +Z), scaled at render.
const MODEL = {
  noseTip: { x: 34, y: 0, z: 0 },
  shoulderL: { x: 12, y: 5, z: 1.5 },
  shoulderR: { x: 12, y: -5, z: 1.5 },
  hipL: { x: -22, y: 4, z: 0 },
  hipR: { x: -22, y: -4, z: 0 },
  tailTip: { x: -30, y: 0, z: 2 },

  wingRootFwdL: { x: 8, y: 4, z: 0 },
  wingTipL: { x: -6, y: 30, z: 0 },
  wingRootAftL: { x: -4, y: 4, z: 0 },
  wingRootFwdR: { x: 8, y: -4, z: 0 },
  wingTipR: { x: -6, y: -30, z: 0 },
  wingRootAftR: { x: -4, y: -4, z: 0 },

  hstabRootFwdL: { x: -20, y: 3, z: 0 },
  hstabTipL: { x: -28, y: 13, z: 0 },
  hstabRootAftL: { x: -30, y: 3, z: 0 },
  hstabRootFwdR: { x: -20, y: -3, z: 0 },
  hstabTipR: { x: -28, y: -13, z: 0 },
  hstabRootAftR: { x: -30, y: -3, z: 0 },

  finRootFwd: { x: -18, y: 0, z: 1 },
  finTop: { x: -27, y: 0, z: 14 },
  finRootAft: { x: -30, y: 0, z: 1 },
} as const

type ModelKey = keyof typeof MODEL

interface Face {
  keys: ModelKey[]
  className: string
}

// Painter's algorithm draws far faces first; the fin is shaded distinctly so
// "up" is always readable.
const FACES: Face[] = [
  { keys: ['wingTipL', 'wingRootFwdL', 'wingRootAftL'], className: 'hud-craft-wing' },
  { keys: ['wingTipR', 'wingRootFwdR', 'wingRootAftR'], className: 'hud-craft-wing' },
  { keys: ['hstabTipL', 'hstabRootFwdL', 'hstabRootAftL'], className: 'hud-craft-stab' },
  { keys: ['hstabTipR', 'hstabRootFwdR', 'hstabRootAftR'], className: 'hud-craft-stab' },
  { keys: ['noseTip', 'shoulderL', 'hipL', 'tailTip', 'hipR', 'shoulderR'], className: 'hud-craft-body' },
  { keys: ['finRootFwd', 'finTop', 'finRootAft'], className: 'hud-craft-fin' },
]

function polygonPoints(keys: ModelKey[], project: (p: Vec3) => Projected, attitude: (p: Vec3) => Vec3): { points: string, depth: number } {
  let depthSum = 0
  const coords = keys.map((key) => {
    const base = MODEL[key]
    const scaled = { x: base.x * MODEL_SCALE, y: base.y * MODEL_SCALE, z: base.z * MODEL_SCALE }
    const projected = project(attitude(scaled))
    depthSum += projected.depth
    return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`
  })
  return { points: coords.join(' '), depth: depthSum / keys.length }
}

export function HudOrientationIndicator({
  rollDeg,
  pitchDeg,
  yawDeg,
  width = 620,
  height = 620,
}: HudOrientationIndicatorProps) {
  if (rollDeg === null || pitchDeg === null || yawDeg === null) {
    return <div className="hud-orientation-empty">Orientation unavailable</div>
  }

  const centerX = width / 2
  const centerY = height / 2
  const wrappedYaw = normalizeDegrees(yawDeg)

  const rollRad = (rollDeg * Math.PI) / 180
  const pitchRad = (pitchDeg * Math.PI) / 180
  const yawRad = (wrappedYaw * Math.PI) / 180

  const project = makeProjector(centerX, centerY)
  const attitude = (point: Vec3) => applyAttitude(point, rollRad, pitchRad, yawRad)

  // Static world-referenced ground grid (z = 0 plane) for a horizon/attitude cue.
  const gridHalf = 150
  const gridStep = 30
  const gridTicks = Array.from(
    { length: (gridHalf * 2) / gridStep + 1 },
    (_, index) => -gridHalf + index * gridStep,
  )
  const gridLines: Array<{ x1: number, y1: number, x2: number, y2: number }> = []
  for (const offset of gridTicks) {
    const alongY0 = project({ x: -gridHalf, y: offset, z: 0 })
    const alongY1 = project({ x: gridHalf, y: offset, z: 0 })
    gridLines.push({ x1: alongY0.x, y1: alongY0.y, x2: alongY1.x, y2: alongY1.y })
    const alongX0 = project({ x: offset, y: -gridHalf, z: 0 })
    const alongX1 = project({ x: offset, y: gridHalf, z: 0 })
    gridLines.push({ x1: alongX0.x, y1: alongX0.y, x2: alongX1.x, y2: alongX1.y })
  }

  const faces = FACES.map((face) => ({
    className: face.className,
    ...polygonPoints(face.keys, project, attitude),
  })).sort((a, b) => b.depth - a.depth)

  const nose = project(attitude({
    x: MODEL.noseTip.x * MODEL_SCALE,
    y: MODEL.noseTip.y * MODEL_SCALE,
    z: MODEL.noseTip.z * MODEL_SCALE,
  }))

  return (
    <svg className="hud-orientation" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Vehicle orientation indicator">
      <rect x={0} y={0} width={width} height={height} className="hud-orientation-bg" rx={10} ry={10} />

      <g className="hud-orient-grid">
        {gridLines.map((line, index) => (
          <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
        ))}
      </g>

      {faces.map((face, index) => (
        <polygon key={index} className={face.className} points={face.points} />
      ))}
      <circle cx={nose.x} cy={nose.y} r={4} className="hud-craft-nose" />

      <text x={centerX} y={22} className="hud-orientation-heading" textAnchor="middle">
        HDG {Math.round(wrappedYaw).toString().padStart(3, '0')}
      </text>
      <text x={14} y={height - 14} className="hud-orientation-text">
        PITCH {pitchDeg.toFixed(1)}°
      </text>
      <text x={width - 14} y={height - 14} textAnchor="end" className="hud-orientation-text">
        ROLL {rollDeg.toFixed(1)}°
      </text>
    </svg>
  )
}
