import { useState } from 'react'

export interface AircraftControls {
  rollDeg: number
  setRollDeg: (value: number) => void
  pitchDeg: number
  setPitchDeg: (value: number) => void
  pitchRateDps: number
  setPitchRateDps: (value: number) => void
  yawRateDps: number
  setYawRateDps: (value: number) => void
  airSpeedMps: number
  setAirSpeedMps: (value: number) => void
  flightPathAngleDeg: number
  setFlightPathAngleDeg: (value: number) => void
  headingDeg: number
  setHeadingDeg: (value: number) => void
  stallSpeedMps: number
  setStallSpeedMps: (value: number) => void
}

/**
 * Shared aircraft-attitude + velocity-vector slider state for the
 * playground-style pages (Playground, Unified) — one state source feeding
 * both a static sample builder and the sidebar controls that adjust it.
 */
export function useAircraftControls(initialStallSpeedMps: number): AircraftControls {
  const [rollDeg, setRollDeg] = useState(0)
  const [pitchDeg, setPitchDeg] = useState(0)
  const [pitchRateDps, setPitchRateDps] = useState(0)
  const [yawRateDps, setYawRateDps] = useState(0)
  const [airSpeedMps, setAirSpeedMps] = useState(22)
  const [flightPathAngleDeg, setFlightPathAngleDeg] = useState(0)
  const [headingDeg, setHeadingDeg] = useState(0)
  const [stallSpeedMps, setStallSpeedMps] = useState(initialStallSpeedMps)

  return {
    rollDeg,
    setRollDeg,
    pitchDeg,
    setPitchDeg,
    pitchRateDps,
    setPitchRateDps,
    yawRateDps,
    setYawRateDps,
    airSpeedMps,
    setAirSpeedMps,
    flightPathAngleDeg,
    setFlightPathAngleDeg,
    headingDeg,
    setHeadingDeg,
    stallSpeedMps,
    setStallSpeedMps,
  }
}
