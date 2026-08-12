/**
 * Sidebar readout for the active system's mission plan: request button, status,
 * and a clickable waypoint list that pans the map. Pure presentation — the plan
 * itself is folded upstream in useVehicleFeed/gcs-core; this component only
 * renders it and forwards clicks.
 */

import type { ConnectionState, MissionPlan } from '@flight-path-hud/gcs-core'
import { formatCoord, formatNumber } from './format'
import { missionGate } from './missionGate'

interface MissionPanelProps {
  mission: MissionPlan
  replayMode: boolean | null
  hasVehicle: boolean
  connectionState: ConnectionState
  onLoadMission: () => void
  onSelectWaypoint: (latDeg: number, lonDeg: number) => void
}

export function MissionPanel({
  mission,
  replayMode,
  hasVehicle,
  connectionState,
  onLoadMission,
  onSelectWaypoint,
}: MissionPanelProps) {
  const gate = missionGate(connectionState, replayMode, hasVehicle)

  return (
    <section className="panel">
      <h2>Mission</h2>
      <button
        type="button"
        className="segment"
        disabled={!gate.enabled}
        onClick={onLoadMission}
        title={gate.reason}
      >
        Load mission
      </button>
      <div className="stat">
        <span>Status</span>
        <strong className={`mission-status ${mission.status}`}>{mission.status}</strong>
      </div>
      {mission.status === 'failed' ? <p className="warn">{mission.reason ?? 'Mission request failed'}</p> : null}
      <div className="stat"><span>Waypoints</span><strong>{mission.items.length}</strong></div>
      <div className="stat"><span>Active</span><strong>{mission.activeIndex ?? '—'}</strong></div>
      <div className="mission-list">
        {mission.items.map((item) => (
          <button
            key={item.seq}
            type="button"
            className={item.seq === mission.activeIndex ? 'mission-row active' : 'mission-row'}
            onClick={() => onSelectWaypoint(item.latDeg, item.lonDeg)}
          >
            <span>{item.seq}</span>
            <span>{item.command}</span>
            <span>{formatCoord(item.latDeg)}</span>
            <span>{formatCoord(item.lonDeg)}</span>
            <span>{formatNumber(item.altM, 1, ' m')}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
