/**
 * Portable HUD instruments and the resolvers behind them.
 *
 * The `logic/` modules are pure and framework-free so they port to C++/ESP32 —
 * see apps/esp32 for the mirrored core. The components are the React rendering
 * of those resolvers; both the hud validation harness and the ground station
 * consume this package so the two can never drift.
 *
 * Consumers must also import `@flight-path-hud/hud-ui/hud.css`.
 */

export * from './constants/mavlinkInputs'
export * from './logic/attitude'
export * from './logic/flightPath'
export * from './logic/heading'
export * from './logic/position'
export * from './logic/telemetry'
export * from './logic/trajectory'
export * from './logic/replay'

export { HudAttitudeIndicator } from './components/HudAttitudeIndicator'
export { HudFlightPathRecorder } from './components/HudFlightPathRecorder'
export { HudFlightState } from './components/HudFlightState'
export { HudHeadingIndicator } from './components/HudHeadingIndicator'
export { HudOrientationIndicator } from './components/HudOrientationIndicator'
export { HudPredictiveTrajectory } from './components/HudPredictiveTrajectory'
export { HudPrimaryFlightDisplay } from './components/HudPrimaryFlightDisplay'
export { HudUnifiedInstrument } from './components/HudUnifiedInstrument'
