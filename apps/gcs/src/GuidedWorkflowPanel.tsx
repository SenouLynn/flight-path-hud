import { GUIDED_STATE_FRESH_MS, guidedModeFor, type ArmDisarmWireFrame, type ConnectionState,
  type FlightStateWireFrame, type GuidedLandWireFrame, type GuidedTakeoffWireFrame, type ModeChangeWireFrame,
  type VehicleState } from '@flight-path-hud/gcs-core'
import { useState } from 'react'

interface Props {
  vehicle: VehicleState | null; flightState: FlightStateWireFrame | null
  connectionState: ConnectionState; replayMode: boolean | null
  modeStatus: ModeChangeWireFrame | null; armStatus: ArmDisarmWireFrame | null
  takeoffStatus: GuidedTakeoffWireFrame | null
  landStatus: GuidedLandWireFrame | null
  onSetGuided: (actor: string) => boolean; onSetArmed: (actor: string, arm: boolean) => boolean
  onTakeoff: (actor: string, altitudeM: number, toleranceM: number) => boolean
  onLand: (actor: string) => boolean
}
const pending = (value: { status: string } | null) => value?.status === 'awaitingAck' || value?.status === 'awaitingObservation'

export function GuidedWorkflowPanel({ vehicle, flightState, connectionState, replayMode,
  modeStatus, armStatus, takeoffStatus, landStatus, onSetGuided, onSetArmed, onTakeoff, onLand }: Props) {
  const [actor, setActor] = useState(''), [altitude, setAltitude] = useState('10')
  const [tolerance, setTolerance] = useState('2'), [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const target = vehicle ? `${vehicle.sysId}:${vehicle.compId}` : '—'
  const confirmationKey = `${target}|${actor.trim()}|${altitude}|${tolerance}`
  const confirmed = confirmedFor === confirmationKey
  const guidedMode = flightState ? guidedModeFor(flightState.vehicleType) : null
  const fresh = flightState !== null && Date.now() - flightState.observedAtMs <= GUIDED_STATE_FRESH_MS
  const inGuided = guidedMode !== null && flightState?.customMode === guidedMode
  const busy = pending(modeStatus) || pending(armStatus) || pending(takeoffStatus) || pending(landStatus)
  const landed = landStatus?.status === 'complete' && (vehicle?.altRelM ?? Number.POSITIVE_INFINITY) <= landStatus.touchdownAltitudeM
  const common = connectionState === 'open' && replayMode === false && fresh && flightState?.autopilotType === 3
    && flightState.vehicleType === 2 && actor.trim() !== '' && confirmed && !busy
  const altitudeM = Number(altitude), toleranceM = Number(tolerance)
  const validTakeoff = altitudeM >= 2 && altitudeM <= 120 && toleranceM >= 0.5 && toleranceM <= 10
  let reason: string | null = null
  if (connectionState !== 'open') reason = 'Open telemetry link required'
  else if (replayMode !== false) reason = replayMode ? 'Commands are disabled during replay' : 'Waiting for live-link mode'
  else if (!fresh) reason = 'Fresh HEARTBEAT state required'
  else if (flightState?.autopilotType !== 3 || flightState.vehicleType !== 2) reason = 'This workflow currently supports ArduCopter only'
  else if (!actor.trim()) reason = 'Operator identity required'
  else if (!confirmed) reason = 'Confirm the exact target and isolated-SITL workflow'
  else if (busy) reason = 'A workflow command is pending'
  const consume = (sent: boolean) => { if (sent) setConfirmedFor(null) }
  const statuses = [modeStatus, armStatus, takeoffStatus, landStatus].filter((value) => value !== null)

  return <section className="panel guided-panel">
    <h2>Guided flight · isolated SITL</h2>
    <p className="panel-note">Stage one verified action at a time for Copter {target}.</p>
    <label className="control"><span>Operator identity</span><input value={actor} onChange={e => setActor(e.target.value)} autoComplete="off" /></label>
    <label className="control"><span>Takeoff altitude (m, 2–120)</span><input value={altitude} onChange={e => setAltitude(e.target.value)} inputMode="decimal" /></label>
    <label className="control"><span>Altitude tolerance (m, 0.5–10)</span><input value={tolerance} onChange={e => setTolerance(e.target.value)} inputMode="decimal" /></label>
    <label className="guided-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmedFor(e.target.checked ? confirmationKey : null)} />
      <span>I confirm exact target {target}, isolated SITL, and no propulsion hardware.</span></label>
    <div className="guided-workflow-actions">
      <button className="segment" disabled={!common || flightState?.armed || inGuided} onClick={() => consume(onSetGuided(actor))}>1 · Enter GUIDED</button>
      <button className="segment" disabled={!common || !inGuided || flightState?.armed} onClick={() => consume(onSetArmed(actor, true))}>2 · Arm</button>
      <button className="segment" disabled={!common || !inGuided || !flightState?.armed || !validTakeoff} onClick={() => consume(onTakeoff(actor, altitudeM, toleranceM))}>3 · Take off</button>
      <button className="segment" disabled={!common || !inGuided || !flightState?.armed} onClick={() => consume(onLand(actor))}>4 · Land</button>
      <button className="segment danger" disabled={!common || !flightState?.armed || !landed} title={landed ? 'Verified touchdown permits standard disarm' : 'Verified touchdown required'} onClick={() => consume(onSetArmed(actor, false))}>5 · Disarm</button>
    </div>
    {reason ? <p className="warn">{reason}</p> : null}
    {statuses.map((status) => <div className={`guided-result ${status.status}`} key={`${status.type}:${status.requestId}`}>
      <div className="stat"><span>{status.type}</span><strong>{status.status}</strong></div>
      {status.reason ? <p className="warn">{status.reason}</p> : null}
    </div>)}
  </section>
}
