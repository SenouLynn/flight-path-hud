import { resolveGuidedWorkflow, type ArmDisarmWireFrame, type ConnectionState,
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
export function GuidedWorkflowPanel({ vehicle, flightState, connectionState, replayMode,
  modeStatus, armStatus, takeoffStatus, landStatus, onSetGuided, onSetArmed, onTakeoff, onLand }: Props) {
  const [actor, setActor] = useState(''), [altitude, setAltitude] = useState('10')
  const [tolerance, setTolerance] = useState('2'), [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const target = vehicle ? `${vehicle.sysId}:${vehicle.compId}` : '—'
  const confirmationKey = `${target}|${actor.trim()}|${altitude}|${tolerance}`
  const confirmed = confirmedFor === confirmationKey
  const altitudeM = Number(altitude), toleranceM = Number(tolerance)
  const workflow = resolveGuidedWorkflow({ connectionState, replayMode, nowMs: Date.now(), flightState,
    actor, confirmed, altitudeM, altitudeToleranceM: toleranceM,
    relativeAltitudeM: vehicle?.altRelM ?? null, modeStatus, armStatus, takeoffStatus, landStatus })
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
      <button className="segment" disabled={!workflow.canEnterGuided} onClick={() => consume(onSetGuided(actor))}>1 · Enter GUIDED</button>
      <button className="segment" disabled={!workflow.canArm} onClick={() => consume(onSetArmed(actor, true))}>2 · Arm</button>
      <button className="segment" disabled={!workflow.canTakeoff} onClick={() => consume(onTakeoff(actor, altitudeM, toleranceM))}>3 · Take off</button>
      <button className="segment" disabled={!workflow.canLand} onClick={() => consume(onLand(actor))}>4 · Land</button>
      <button className="segment danger" disabled={!workflow.canDisarm} title={workflow.landed ? 'Verified touchdown permits standard disarm' : 'Verified touchdown required'} onClick={() => consume(onSetArmed(actor, false))}>5 · Disarm</button>
    </div>
    {workflow.reason ? <p className="warn">{workflow.reason}</p> : null}
    {statuses.map((status) => <div className={`guided-result ${status.status}`} key={`${status.type}:${status.requestId}`}>
      <div className="stat"><span>{status.type}</span><strong>{status.status}</strong></div>
      {status.reason ? <p className="warn">{status.reason}</p> : null}
    </div>)}
  </section>
}
