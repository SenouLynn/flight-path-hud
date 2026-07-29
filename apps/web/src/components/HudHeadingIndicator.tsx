function normalizeDegrees(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function shortestDeltaDegrees(fromDeg: number, toDeg: number): number {
  const raw = normalizeDegrees(toDeg) - normalizeDegrees(fromDeg)
  if (raw > 180) {
    return raw - 360
  }
  if (raw < -180) {
    return raw + 360
  }
  return raw
}

function formatHeadingLabel(deg: number): string {
  const wrapped = normalizeDegrees(deg)

  if (wrapped === 0) {
    return 'N'
  }
  if (wrapped === 90) {
    return 'E'
  }
  if (wrapped === 180) {
    return 'S'
  }
  if (wrapped === 270) {
    return 'W'
  }

  return wrapped.toString().padStart(3, '0')
}

export interface HudHeadingIndicatorProps {
  headingDeg: number | null
  width?: number
  height?: number
}

export function HudHeadingIndicator({
  headingDeg,
  width = 420,
  height = 92,
}: HudHeadingIndicatorProps) {
  if (headingDeg === null) {
    return <div className="hud-placeholder">Heading unavailable</div>
  }

  const centerX = width / 2
  const centerY = height / 2
  const pixelsPerDegree = width / 120
  const majorTickStep = 10
  const minorTickStep = 5
  const rangeDeg = 70

  const ticks: Array<{ value: number, x: number, isMajor: boolean }> = []

  for (let value = Math.floor((headingDeg - rangeDeg) / minorTickStep) * minorTickStep; value <= headingDeg + rangeDeg; value += minorTickStep) {
    const delta = shortestDeltaDegrees(headingDeg, value)
    const x = centerX + delta * pixelsPerDegree
    ticks.push({
      value: normalizeDegrees(value),
      x,
      isMajor: value % majorTickStep === 0,
    })
  }

  return (
    <svg className="hud-heading" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Heading indicator">
      <rect x={0} y={0} width={width} height={height} className="hud-heading-bg" />

      <line x1={0} y1={height - 20} x2={width} y2={height - 20} className="hud-line-muted" />

      {ticks.map((tick) => (
        <g key={`${tick.value}-${tick.x}`}>
          <line
            x1={tick.x}
            y1={height - 20}
            x2={tick.x}
            y2={tick.isMajor ? height - 40 : height - 32}
            className="hud-line"
          />
          {tick.isMajor ? (
            <text x={tick.x} y={height - 46} className="hud-heading-label" textAnchor="middle">
              {formatHeadingLabel(tick.value)}
            </text>
          ) : null}
        </g>
      ))}

      <polygon
        points={`${centerX - 9},14 ${centerX + 9},14 ${centerX},30`}
        className="hud-center-bug"
      />
      <text x={centerX} y={centerY + 2} className="hud-heading-readout" textAnchor="middle">
        {normalizeDegrees(Math.round(headingDeg)).toString().padStart(3, '0')}
      </text>
    </svg>
  )
}
