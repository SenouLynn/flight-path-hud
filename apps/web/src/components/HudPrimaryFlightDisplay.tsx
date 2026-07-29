import { HudAttitudeIndicator } from './HudAttitudeIndicator'
import { HudHeadingIndicator } from './HudHeadingIndicator'

export interface HudPrimaryFlightDisplayProps {
  headingDeg: number | null
  pitchDeg: number | null
  rollDeg: number | null
  width?: number
}

export function HudPrimaryFlightDisplay({
  headingDeg,
  pitchDeg,
  rollDeg,
  width = 820,
}: HudPrimaryFlightDisplayProps) {
  return (
    <div className="hud-pfd" role="group" aria-label="Primary flight display">
      <HudHeadingIndicator headingDeg={headingDeg} width={width} height={96} />
      <HudAttitudeIndicator pitchDeg={pitchDeg} rollDeg={rollDeg} width={width} height={330} />
    </div>
  )
}
