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
  profile?: 'default' | 'micro' | 'portrait'
}

export function HudHeadingIndicator({
  headingDeg,
  width = 420,
  height = 92,
  profile = 'default',
}: HudHeadingIndicatorProps) {
  if (headingDeg === null) {
    return <div className="hud-placeholder">Heading unavailable</div>
  }

  const centerX = width / 2
  const centerY = height / 2
  const isMicro = profile === 'micro' || width <= 80
  const compact = height <= 56
  // Compact geometry is expressed as fractions of height (calibrated against
  // the original height=48 constants) rather than fixed pixel offsets, so the
  // tape keeps its proportions when height is pushed well below 48 (e.g. the
  // half-height 24px tape used by the primary flight display).
  const tickBaseline = height - (compact ? height * 0.1667 : 20)
  const majorTickTop = height - (compact ? height * 0.3958 : 40)
  const minorTickTop = height - (compact ? height * 0.2917 : 32)
  const labelY = height - (compact ? height * 0.4792 : 46)
  const rangeDeg = isMicro ? 15 : width <= 96 ? 20 : width <= 180 ? 35 : 70
  const pixelsPerDegree = width / (rangeDeg * 2)
  const majorTickStep = 10
  const minorTickStep = 5
  const labelFontSize = compact ? Math.max(2, Math.min(7, height * 0.28)) : 9
  const readoutFontSize = isMicro
    ? Math.max(4, Math.min(8, height * 0.52))
    : compact ? Math.max(4, Math.min(16, height * 0.62)) : 22
  const baselineStrokeWidth = isMicro ? 0.75 : undefined
  const tickStrokeWidth = isMicro ? 0.85 : undefined

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
    <svg className={`hud-heading${compact ? ' hud-heading-compact' : ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Heading indicator">
      <rect x={0} y={0} width={width} height={height} className="hud-heading-bg" />

      <line x1={0} y1={tickBaseline} x2={width} y2={tickBaseline} className="hud-line-muted" style={baselineStrokeWidth === undefined ? undefined : { strokeWidth: baselineStrokeWidth }} />

      {ticks.map((tick) => (
        <g key={`${tick.value}-${tick.x}`}>
          <line
            x1={tick.x}
            y1={tickBaseline}
            x2={tick.x}
            y2={tick.isMajor ? majorTickTop : minorTickTop}
            className="hud-line"
            style={tickStrokeWidth === undefined ? undefined : { strokeWidth: tickStrokeWidth }}
          />
          {tick.isMajor && !isMicro ? (
            <text x={tick.x} y={labelY} className="hud-heading-label" textAnchor="middle" style={{ fontSize: `${labelFontSize}px` }}>
              {formatHeadingLabel(tick.value)}
            </text>
          ) : null}
        </g>
      ))}

      <text x={centerX} y={centerY + 2} className="hud-heading-readout" textAnchor="middle" style={{ fontSize: `${readoutFontSize}px` }}>
        {normalizeDegrees(Math.round(headingDeg)).toString().padStart(3, '0')}
      </text>
    </svg>
  )
}
