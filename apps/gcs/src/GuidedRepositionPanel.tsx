import { guidedRepositionGate, type ConnectionState,
  type FlightStateWireFrame, type GuidedRepositionDraft, type GuidedRepositionWireFrame,
  type VehicleState } from '@flight-path-hud/gcs-core'
import { useEffect, useState } from 'react'
import { guidedConfirmationKey, guidedDefaults, showGuidedGateReason } from './guidedRepositionPresentation'

interface Props {
  vehicle: VehicleState | null
  flightState: FlightStateWireFrame | null
  status: GuidedRepositionWireFrame | null
  connectionState: ConnectionState
  replayMode: boolean | null
  onSend: (actor: string, draft: GuidedRepositionDraft) => boolean
  latitude: string
  longitude: string
  onCoordinatesChange: (latitude: string, longitude: string) => void
  pickingOnMap: boolean
  onToggleMapPicking: () => void
}

const numberValue = (value: string) => value.trim() === '' ? Number.NaN : Number(value)

export function GuidedRepositionPanel({ vehicle, flightState, status, connectionState,
  replayMode, onSend, latitude, longitude, onCoordinatesChange, pickingOnMap,
  onToggleMapPicking }: Props) {
  const [actor, setActor] = useState('')
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const [submittedFor, setSubmittedFor] = useState<string | null>(null)
  const [altitude, setAltitude] = useState('')
  const [arrivalRadius, setArrivalRadius] = useState('8')
  const [altitudeTolerance, setAltitudeTolerance] = useState('5')
  const [loiterRadius, setLoiterRadius] = useState('75')
  const [loiterDirection, setLoiterDirection] = useState<'clockwise' | 'counterclockwise'>('clockwise')

  const targetKey = vehicle === null ? null : `${vehicle.sysId}:${vehicle.compId}`
  const confirmationKey = guidedConfirmationKey({ targetKey, actor, latitude, longitude, altitude,
    arrivalRadius, altitudeTolerance, loiterRadius, loiterDirection })
  const confirmed = confirmedFor === confirmationKey

  const isPlane = flightState?.vehicleType === 1
  useEffect(() => {
    const defaults = guidedDefaults(isPlane)
    setArrivalRadius(defaults.arrivalRadius)
    setAltitudeTolerance(defaults.altitudeTolerance)
  }, [isPlane])
  const draft: GuidedRepositionDraft = { latitudeDeg: numberValue(latitude),
    longitudeDeg: numberValue(longitude), relativeAltitudeM: numberValue(altitude),
    arrivalRadiusM: numberValue(arrivalRadius), altitudeToleranceM: numberValue(altitudeTolerance),
    ...(isPlane ? { loiterRadiusM: numberValue(loiterRadius), loiterDirection } : {}) }
  const gate = guidedRepositionGate({ connectionState, replayMode, flightState,
    nowMs: Date.now(), actor, confirmed, draft })
  const pending = status?.status === 'awaitingAck' || status?.status === 'awaitingObservation'

  const useCurrentPosition = () => {
    if (vehicle?.latDeg !== null && vehicle?.latDeg !== undefined
      && vehicle?.lonDeg !== null && vehicle?.lonDeg !== undefined) {
      onCoordinatesChange(String(vehicle.latDeg), String(vehicle.lonDeg))
    }
    if (vehicle?.altRelM !== null && vehicle?.altRelM !== undefined) setAltitude(String(vehicle.altRelM))
  }

  return <section className="panel guided-panel">
    <h2>Guided reposition · isolated SITL</h2>
    <button type="button" className="segment" onClick={useCurrentPosition} disabled={vehicle === null || vehicle.latDeg === null || vehicle.lonDeg === null}>Use current position</button>
    <button type="button" className={pickingOnMap ? 'segment active' : 'segment'} onClick={onToggleMapPicking}>{pickingOnMap ? 'Cancel map pick' : 'Pick on map'}</button>
    {pickingOnMap ? <p className="map-pick-hint">Click the map to set the draft target · Esc cancels</p> : null}
    <label className="control"><span>Latitude</span><input value={latitude} onChange={e => onCoordinatesChange(e.target.value, longitude)} inputMode="decimal" /></label>
    <label className="control"><span>Longitude</span><input value={longitude} onChange={e => onCoordinatesChange(latitude, e.target.value)} inputMode="decimal" /></label>
    <label className="control"><span>Relative altitude (m)</span><input value={altitude} onChange={e => setAltitude(e.target.value)} inputMode="decimal" /></label>
    <label className="control"><span>Arrival radius (m, max 120)</span><input value={arrivalRadius} onChange={e => setArrivalRadius(e.target.value)} inputMode="decimal" /></label>
    <label className="control"><span>Altitude tolerance (m, max 20)</span><input value={altitudeTolerance} onChange={e => setAltitudeTolerance(e.target.value)} inputMode="decimal" /></label>
    {isPlane ? <><label className="control"><span>Loiter radius (m, max 100)</span><input value={loiterRadius} onChange={e => setLoiterRadius(e.target.value)} inputMode="decimal" /></label>
      <label className="control"><span>Loiter direction</span><select value={loiterDirection} onChange={e => setLoiterDirection(e.target.value as typeof loiterDirection)}><option value="clockwise">Clockwise</option><option value="counterclockwise">Counterclockwise</option></select></label></> : null}
    <label className="control"><span>Operator identity</span><input value={actor} onChange={e => setActor(e.target.value)} autoComplete="off" /></label>
    <label className="guided-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmedFor(e.target.checked ? confirmationKey : null)} />
      <span>I confirm target {targetKey ?? '—'}, its armed Guided state, and this bounded movement.</span></label>
    <button type="button" className="segment guided-send" disabled={!gate.enabled || pending}
      title={pending ? 'A reposition is already pending for this target' : gate.reason}
      onClick={() => {
        if (gate.enabled && onSend(actor, draft)) {
          setSubmittedFor(confirmationKey)
          setConfirmedFor(null)
        }
      }}>Send reposition</button>
    {showGuidedGateReason({ enabled: gate.enabled, pending, submittedFor, confirmationKey })
      ? <p className="warn">{gate.reason}</p> : null}
    {status ? <div className={`guided-result ${status.status}`} role="status">
      <div className="stat"><span>Request</span><strong>{status.requestId ?? 'rejected'}</strong></div>
      <div className="stat"><span>Status</span><strong>{status.status}</strong></div>
      {status.reason ? <p className="warn">{status.reason}</p> : null}
      {status.horizontalDistanceM !== null ? <div className="stat"><span>Horizontal error</span><strong>{status.horizontalDistanceM.toFixed(1)} m</strong></div> : null}
      {status.altitudeErrorM !== null ? <div className="stat"><span>Altitude error</span><strong>{status.altitudeErrorM.toFixed(1)} m</strong></div> : null}
    </div> : null}
  </section>
}
