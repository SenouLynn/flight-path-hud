import { HudAttitudeIndicator } from './HudAttitudeIndicator'
import { HudHeadingIndicator } from './HudHeadingIndicator'

export interface HudPrimaryFlightDisplayProps {
  headingDeg: number | null
  pitchDeg: number | null
  rollDeg: number | null
  width?: number
  height?: number
  headingHeight?: number
  attitudeHeight?: number
}

export function HudPrimaryFlightDisplay({
  headingDeg,
  pitchDeg,
  rollDeg,
  width = 820,
  height,
  headingHeight = 24,
  attitudeHeight = 260,
}: HudPrimaryFlightDisplayProps) {
  const resolvedHeadingHeight = height === undefined
    ? headingHeight
    : Math.max(20, Math.min(height - 40, headingHeight))
  const resolvedAttitudeHeight = height === undefined
    ? attitudeHeight
    : Math.max(40, height - resolvedHeadingHeight)

  return (
    <div className="hud-pfd" role="group" aria-label="Primary flight display">
      <HudHeadingIndicator headingDeg={headingDeg} width={width} height={resolvedHeadingHeight} />
      <HudAttitudeIndicator pitchDeg={pitchDeg} rollDeg={rollDeg} width={width} height={resolvedAttitudeHeight} />
    </div>
  )
}
