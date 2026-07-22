function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface HudAttitudeIndicatorProps {
  pitchDeg: number | null
  rollDeg: number | null
  width?: number
  height?: number
}

export function HudAttitudeIndicator({
  pitchDeg,
  rollDeg,
  width = 420,
  height = 320,
}: HudAttitudeIndicatorProps) {
  if (pitchDeg === null || rollDeg === null) {
    return <div className="hud-placeholder">Attitude unavailable</div>
  }

  const cx = width / 2
  const cy = height / 2
  const pitchPxPerDeg = 6
  const clampedPitch = clamp(pitchDeg, -30, 30)
  const pitchOffset = clampedPitch * pitchPxPerDeg
  const roll = -rollDeg
  const clipPathId = `hudAttitudeClip-${Math.round(width)}-${Math.round(height)}`

  const ladderSteps = [-30, -20, -10, 10, 20, 30]

  return (
    <svg className="hud-attitude" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Attitude and horizon indicator">
      <defs>
        <clipPath id={clipPathId} clipPathUnits="userSpaceOnUse">
          <rect x={26} y={26} width={width - 52} height={height - 72} rx={8} ry={8} />
        </clipPath>
      </defs>

      <rect x={0} y={0} width={width} height={height} className="hud-att-bg" />

      <g clipPath={`url(#${clipPathId})`}>
        <g transform={`translate(${cx}, ${cy + 6}) rotate(${roll}) translate(0, ${pitchOffset})`}>
          <rect x={-width * 3} y={-height * 3} width={width * 6} height={height * 3} className="hud-sky" />
          <rect x={-width * 3} y={0} width={width * 6} height={height * 3} className="hud-ground" />
          <line x1={-width * 3} y1={0} x2={width * 3} y2={0} className="hud-horizon" />

          {ladderSteps.map((step) => {
            const y = -step * pitchPxPerDeg
            return (
              <g key={step}>
                <line
                  x1={-58}
                  y1={y}
                  x2={58}
                  y2={y}
                  className="hud-ladder"
                />
                <text x={-66} y={y + 4} textAnchor="end" className="hud-ladder-label">{Math.abs(step)}</text>
                <text x={66} y={y + 4} textAnchor="start" className="hud-ladder-label">{Math.abs(step)}</text>
              </g>
            )
          })}
        </g>
      </g>

      <rect x={26} y={26} width={width - 52} height={height - 72} rx={8} ry={8} className="hud-window-frame" />

      <g transform={`translate(${cx}, 32)`}>
        <path
          d="M -88 0 A 88 88 0 0 1 88 0"
          className="hud-roll-arc"
        />
        {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((mark) => {
          const rad = (mark * Math.PI) / 180
          const x1 = Math.sin(rad) * 82
          const y1 = -Math.cos(rad) * 82
          const x2 = Math.sin(rad) * (mark % 30 === 0 ? 70 : 74)
          const y2 = -Math.cos(rad) * (mark % 30 === 0 ? 70 : 74)
          return <line key={mark} x1={x1} y1={y1} x2={x2} y2={y2} className="hud-roll-mark" />
        })}
        <polygon points="0,-92 -6,-82 6,-82" className="hud-center-bug" />
      </g>

      <g transform={`translate(${cx}, ${cy + 6})`}>
        <line x1={-58} y1={0} x2={-14} y2={0} className="hud-aircraft" />
        <line x1={14} y1={0} x2={58} y2={0} className="hud-aircraft" />
        <path d="M -14 0 L -6 10 L 6 10 L 14 0" className="hud-aircraft" fill="none" />
      </g>

      <text x={36} y={height - 24} className="hud-status-text">PITCH {pitchDeg.toFixed(1)}°</text>
      <text x={width - 36} y={height - 24} textAnchor="end" className="hud-status-text">ROLL {rollDeg.toFixed(1)}°</text>
    </svg>
  )
}
