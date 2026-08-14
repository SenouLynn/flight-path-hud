import { resolveGuidedWorkflow, type ArmDisarmWireFrame, type ConnectionState,
  type FlightStateWireFrame, type GuidedLandWireFrame, type GuidedTakeoffWireFrame, type ModeChangeWireFrame,
  type VehicleState } from '@flight-path-hud/gcs-core'
import { useState } from 'react'

interface Props {
  vehicle: VehicleState | null; flightState: FlightStateWireFrame | null
  actor: string
  connectionState: ConnectionState; replayMode: boolean | null
  modeStatus: ModeChangeWireFrame | null; armStatus: ArmDisarmWireFrame | null
  takeoffStatus: GuidedTakeoffWireFrame | null
  landStatus: GuidedLandWireFrame | null
  onSetGuided: (actor: string) => boolean; onSetArmed: (actor: string, arm: boolean) => boolean
  onTakeoff: (actor: string, altitudeM: number, toleranceM: number) => boolean
  onLand: (actor: string) => boolean
}
export function GuidedWorkflowPanel({ vehicle, flightState, actor, connectionState, replayMode,
  modeStatus, armStatus, takeoffStatus, landStatus, onSetGuided, onSetArmed, onTakeoff, onLand }: Props) {
  const [altitude, setAltitude] = useState('10')
  const [tolerance, setTolerance] = useState('2'), [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const [armOpen, setArmOpen] = useState(false)
  const target = vehicle ? `${vehicle.sysId}:${vehicle.compId}` : '—'
  const altitudeM = Number(altitude), toleranceM = Number(tolerance)
  const workflow = resolveGuidedWorkflow({ target: vehicle ? { sysId: vehicle.sysId, compId: vehicle.compId } : null,
    connectionState, replayMode, nowMs: Date.now(), flightState,
    actor, confirmedFor, altitudeM, altitudeToleranceM: toleranceM,
    relativeAltitudeM: vehicle?.altRelM ?? null, modeStatus, armStatus, takeoffStatus, landStatus })
  const submitArm = () => {
    if (!onSetArmed(actor, true)) return
    setConfirmedFor(null)
    setArmOpen(false)
  }
  const statuses = [modeStatus, armStatus, takeoffStatus, landStatus].filter((value) => value !== null)

  return <section className="flight-modes-panel" aria-labelledby="flight-modes-title">
    <div className="flight-modes-heading">
      <div><h2 id="flight-modes-title">Flight modes</h2><span>Copter {target}</span></div>
    </div>
    <div className="guided-workflow-actions">
      <button type="button" className="segment" disabled={!workflow.canEnterGuided} onClick={() => onSetGuided(actor)}>Enter GUIDED</button>
      <div className="guided-arm-control">
        <button type="button" className={`segment${armOpen ? ' active' : ''}`} disabled={!workflow.canPrepareArm}
          aria-expanded={armOpen} aria-controls="guided-arm-menu" onClick={() => setArmOpen(open => !open)}>Arm</button>
        {armOpen ? <div className="guided-arm-menu" id="guided-arm-menu">
          <label className="control"><span>Takeoff altitude (m, 2–120)</span><input value={altitude} onChange={e => setAltitude(e.target.value)} inputMode="decimal" /></label>
          <label className="control"><span>Altitude tolerance (m, 0.5–10)</span><input value={tolerance} onChange={e => setTolerance(e.target.value)} inputMode="decimal" /></label>
          <label className="guided-confirm"><input type="checkbox" checked={workflow.confirmed}
            onChange={e => setConfirmedFor(e.target.checked ? workflow.confirmationKey : null)} />
            <span>I confirm target {target} and no propulsion hardware.</span></label>
          {!workflow.takeoffInputsValid ? <p className="warn">Enter a valid altitude and tolerance.</p> : null}
          <button type="button" className="segment guided-arm-submit" disabled={!workflow.canArm} onClick={submitArm}>Submit arm</button>
        </div> : null}
      </div>
      <button type="button" className="segment" disabled={!workflow.canTakeoff} onClick={() => onTakeoff(actor, altitudeM, toleranceM)}>Take off</button>
      <button type="button" className="segment" disabled={!workflow.canLand} onClick={() => onLand(actor)}>Land</button>
      <button type="button" className="segment danger" disabled={!workflow.canDisarm} title={workflow.landed ? 'Verified touchdown permits standard disarm' : 'Verified touchdown required'} onClick={() => onSetArmed(actor, false)}>Disarm</button>
    </div>
    {workflow.reason ? <p className="warn flight-modes-warning">{workflow.reason}</p> : null}
    {statuses.length > 0 ? <div className="flight-mode-statuses">{statuses.map((status) => <div className={`guided-result ${status.status}`} key={`${status.type}:${status.requestId}`}>
      <span>{status.type}</span><strong>{status.status}</strong>
      {status.reason ? <span className="warn">{status.reason}</span> : null}
    </div>)}</div> : null}
  </section>
}
