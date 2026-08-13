import {
  MAV_MISSION_ACCEPTED, encodeMissionClearAll, encodeMissionUploadCount,
  encodeMissionUploadItemInt,
} from './missionUploadProtocol.js'

export const MISSION_UPLOAD_TIMEOUT_MS = 1500
export const MISSION_UPLOAD_MAX_RETRIES = 2

const validUint8 = (value) => Number.isInteger(value) && value > 0 && value <= 255
const validInt32 = (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647

function normalizeItem(item, seq) {
  if (item === null || typeof item !== 'object') throw new Error(`item ${seq} must be an object`)
  if (typeof item.current !== 'boolean' || typeof item.autocontinue !== 'boolean') throw new Error(`item ${seq} requires boolean current/autocontinue`)
  const normalized = {
    seq,
    command: item.command,
    frameId: item.frameId,
    current: item.current,
    autocontinue: item.autocontinue,
    param1: item.param1 ?? 0, param2: item.param2 ?? 0,
    param3: item.param3 ?? 0, param4: item.param4 ?? 0,
    latDegE7: item.latDegE7, lonDegE7: item.lonDegE7, altM: item.altM,
  }
  if (!Number.isInteger(normalized.command) || normalized.command < 0 || normalized.command > 65535) throw new Error(`item ${seq} has invalid command`)
  if (!Number.isInteger(normalized.frameId) || normalized.frameId < 0 || normalized.frameId > 255) throw new Error(`item ${seq} has invalid frameId`)
  if (!validInt32(normalized.latDegE7) || !validInt32(normalized.lonDegE7)) throw new Error(`item ${seq} has invalid coordinates`)
  if (![normalized.param1, normalized.param2, normalized.param3, normalized.param4, normalized.altM].every(Number.isFinite)) throw new Error(`item ${seq} has non-finite numeric fields`)
  return Object.freeze(normalized)
}

function itemsEqual(expected, observed) {
  if (!Array.isArray(observed) || expected.length !== observed.length) return false
  return expected.every((item, index) => {
    const other = observed[index]
    if (other === null || typeof other !== 'object') return false
    return ['seq', 'command', 'frameId', 'current', 'autocontinue', 'latDegE7', 'lonDegE7']
      .every((field) => item[field] === other[field])
      && ['param1', 'param2', 'param3', 'param4', 'altM']
        .every((field) => Math.abs(item[field] - other[field]) <= 1e-4)
  })
}

/** Pure, single-target mission replacement transaction; owns no socket or timer. */
export function createMissionUpload({ send, now = Date.now, sysId = 255, compId = 190,
  targetSystemId, targetComponentId, timeoutMs = MISSION_UPLOAD_TIMEOUT_MS,
  maxRetries = MISSION_UPLOAD_MAX_RETRIES } = {}) {
  if (!validUint8(targetSystemId) || !validUint8(targetComponentId)) throw new Error('mission upload requires an exact non-broadcast target')
  let status = 'idle', reason = null, items = [], requested = new Set()
  let lastBuffer = null, awaitingSince = null, attempts = 0

  const transmit = (buffer) => {
    lastBuffer = buffer
    if (send(buffer) === false) { fail('target route disappeared before transmit'); return false }
    awaitingSince = now(); attempts = 1; return true
  }
  const fail = (why) => { status = 'failed'; reason = why; awaitingSince = null; lastBuffer = null }
  const sendCount = () => transmit(encodeMissionUploadCount({ sysId, compId, targetSystemId, targetComponentId, count: items.length }))

  return {
    start(candidateItems) {
      if (!Array.isArray(candidateItems) || candidateItems.length === 0 || candidateItems.length > 65535) throw new Error('mission must contain 1..65535 items')
      items = candidateItems.map(normalizeItem)
      requested = new Set(); reason = null; status = 'clearing'
      transmit(encodeMissionClearAll({ sysId, compId, targetSystemId, targetComponentId }))
      return this.getState()
    },

    ingestEnvelope(envelope) {
      if (envelope?.sysId !== targetSystemId || envelope?.compId !== targetComponentId) return false
      if (envelope.messageName === 'MISSION_ACK') {
        const result = envelope.payload?.missionAck?.type
        if (status === 'clearing') {
          if (result !== MAV_MISSION_ACCEPTED) { fail(`mission clear rejected (MAV_MISSION_RESULT=${result})`); return true }
          status = 'uploading'; reason = null; sendCount(); return true
        }
        if (status === 'uploading') {
          if (result !== MAV_MISSION_ACCEPTED) { fail(`mission upload rejected (MAV_MISSION_RESULT=${result})`); return true }
          if (requested.size !== items.length) { fail('vehicle accepted mission before requesting every item'); return true }
          status = 'awaitingReadback'; awaitingSince = null; lastBuffer = null; return true
        }
      }
      if (envelope.messageName === 'MISSION_REQUEST_INT' && status === 'uploading') {
        const request = envelope.payload?.missionRequestInt
        if (request?.targetSystem !== sysId || request?.targetComponent !== compId) return false
        if (!Number.isInteger(request.seq) || request.seq < 0 || request.seq >= items.length) { fail(`vehicle requested invalid mission sequence ${request?.seq}`); return true }
        requested.add(request.seq)
        transmit(encodeMissionUploadItemInt({ sysId, compId, targetSystemId, targetComponentId, item: items[request.seq] }))
        return true
      }
      return false
    },

    confirmReadback(observedItems) {
      if (status !== 'awaitingReadback') return false
      if (!itemsEqual(items, observedItems)) { fail('mission read-back did not match uploaded mission'); return true }
      status = 'complete'; reason = null; return true
    },

    abort(failureReason) {
      if (['complete', 'failed', 'idle'].includes(status)) return false
      fail(failureReason)
      return true
    },

    tick(nowMs = now()) {
      if (awaitingSince === null || !['clearing', 'uploading'].includes(status)) return false
      if (nowMs - awaitingSince < timeoutMs) return false
      if (attempts > maxRetries) { fail(`mission upload timeout while ${status}`); return true }
      if (send(lastBuffer) === false) { fail('target route disappeared before retry'); return true }
      attempts += 1; awaitingSince = nowMs; return true
    },

    getState: () => ({ status, reason, itemCount: items.length, requestedCount: requested.size, attempts }),
  }
}
