const key = (sysId, compId) => `${sysId}:${compId}`

/**
 * Read-only per-target HEARTBEAT state for future command pre/post-condition checks.
 * Keeps raw numeric MAVLink values: custom-mode meanings remain vehicle-specific.
 */
export function createFlightStateTracker({ now = Date.now, staleAfterMs = 3000 } = {}) {
  const states = new Map()
  const fresh = (state, atMs) => state !== undefined && atMs - state.observedAtMs <= staleAfterMs

  return {
    ingestEnvelope(envelope) {
      const heartbeat = envelope?.payload?.heartbeat
      if (envelope?.messageName !== 'HEARTBEAT' || heartbeat === null || typeof heartbeat !== 'object') return null
      if (!Number.isInteger(envelope.sysId) || !Number.isInteger(envelope.compId)) return null
      const state = { type: 'flightState', sysId: envelope.sysId, compId: envelope.compId,
        armed: heartbeat.armed === true, baseMode: heartbeat.baseMode,
        customMode: heartbeat.customMode, systemStatus: heartbeat.systemStatus,
        vehicleType: heartbeat.vehicleType, autopilotType: heartbeat.autopilotType,
        observedAtMs: now() }
      states.set(key(envelope.sysId, envelope.compId), state)
      return state
    },
    getFreshState(sysId, compId, atMs = now()) {
      const state = states.get(key(sysId, compId))
      return fresh(state, atMs) ? state : null
    },
    snapshot(atMs = now()) {
      return [...states.values()].filter((state) => fresh(state, atMs))
        .sort((left, right) => left.sysId - right.sysId || left.compId - right.compId)
    },
  }
}
