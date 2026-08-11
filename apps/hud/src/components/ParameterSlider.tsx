export interface ParameterSliderProps {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  /** Optional decimal places for the numeric readout (defaults to 0). */
  precision?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * A single bounded parameter control: label + range input + live numeric
 * readout. Values are clamped to [min, max] so out-of-range keyboard entry
 * can't drive the resolvers with nonsense. Mirrors the clamp-to-bounds pattern
 * used by the flight-path recorder's orbit controls.
 */
export function ParameterSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  precision = 0,
}: ParameterSliderProps) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number.parseFloat(event.target.value)
    if (Number.isNaN(next)) {
      return
    }
    onChange(clamp(next, min, max))
  }

  return (
    <label className="parameter-slider">
      <span className="parameter-slider-head">
        <span className="parameter-slider-label">{label}</span>
        <span className="parameter-slider-value">
          {value.toFixed(precision)}
          <em>{unit}</em>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
      />
    </label>
  )
}

export default ParameterSlider
