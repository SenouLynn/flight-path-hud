import { MAV_MISSION_ACCEPTED, encodeMissionAck, encodeMissionRequestInt, encodeMissionRequestList } from './encode.js'

// MAV_MISSION_RESULT value the vehicle sends unsolicited on a real, ArduPilot-observed
// quirk: a stray INVALID_SEQUENCE ack while items are still in flight. Carried over
// from QGroundControl's PlanManager, which treats it the same way (ignore, not fatal).
const MAV_MISSION_INVALID_SEQUENCE = 13

// QGroundControl's PlanManager.h timeouts/retries — not invented (design doc §2).
export const MISSION_COUNT_TIMEOUT_MS = 1500
export const MISSION_ITEM_TIMEOUT_MS = 250
export const MAX_RETRIES = 5

/**
 * One vehicle's mission-pull state machine, transport-agnostic like bridgeCore.js:
 * fed decoded envelopes and a `now`/`send` seam, no socket or timer of its own.
 *
 *   idle -> requested (sent MISSION_REQUEST_LIST)
 *        -> collecting (sent MISSION_REQUEST_INT per index; tracks the next expected one)
 *        -> complete (all items in; MISSION_ACK sent) -> published (via acknowledgePublished())
 *   (any state) -> failed (retries exhausted / unrecoverable MISSION_ACK)
 *
 * `acknowledgePublished()` exists so this module never has to know what "publish"
 * means — the router (missionRouter.js) calls it once it has actually broadcast the
 * 'complete' snapshot, which is what actually closes the loop to 'published'.
 */
export function createMissionSync({ send, now = Date.now, sysId, compId, targetSystemId, targetComponentId }) {
  let status = 'idle'
  let reason = null
  let expectedCount = null
  let items = []
  let nextSeq = 0
  let retryCount = 0
  let awaitingSince = null
  let activeIndex = null

  function sendRequestList() {
    send(encodeMissionRequestList({ sysId, compId, targetSystemId, targetComponentId }))
    awaitingSince = now()
  }

  function sendRequestItem(seq) {
    send(encodeMissionRequestInt({ sysId, compId, targetSystemId, targetComponentId, seq }))
    awaitingSince = now()
  }

  function sendAck(type) {
    send(encodeMissionAck({ sysId, compId, targetSystemId, targetComponentId, type }))
  }

  function fail(failureReason) {
    status = 'failed'
    reason = failureReason
    expectedCount = null
    items = []
    nextSeq = 0
    retryCount = 0
    awaitingSince = null
  }

  return {
    requestMission() {
      status = 'requested'
      reason = null
      expectedCount = null
      items = []
      nextSeq = 0
      retryCount = 0
      sendRequestList()
    },

    /** Returns whether this envelope actually changed observable state, so the
     * router only rebuilds/republishes a wire frame when something moved. */
    ingestEnvelope(envelope) {
      const { messageName, payload } = envelope

      if (messageName === 'MISSION_CURRENT') {
        activeIndex = payload.missionCurrent.seq
        return true
      }

      if (messageName === 'MISSION_COUNT' && status === 'requested') {
        expectedCount = payload.missionCount.count
        retryCount = 0

        if (expectedCount === 0) {
          items = []
          sendAck(MAV_MISSION_ACCEPTED)
          status = 'complete'
          return true
        }

        items = new Array(expectedCount)
        nextSeq = 0
        status = 'collecting'
        sendRequestItem(0)
        return true
      }

      if (messageName === 'MISSION_ITEM_INT' && status === 'collecting') {
        const item = payload.missionItemInt

        if (item.seq !== nextSeq) {
          // Recoverable per spec: drop it, re-ask for the index we actually want.
          sendRequestItem(nextSeq)
          return true
        }

        items[nextSeq] = item
        nextSeq += 1
        retryCount = 0

        if (nextSeq >= expectedCount) {
          sendAck(MAV_MISSION_ACCEPTED)
          status = 'complete'
          return true
        }

        sendRequestItem(nextSeq)
        return true
      }

      if (messageName === 'MISSION_ACK' && status === 'collecting') {
        const { type } = payload.missionAck

        if (type === MAV_MISSION_INVALID_SEQUENCE) {
          // ArduPilot quirk, carried over from QGC: spurious while in flight, not fatal.
          return false
        }

        if (type !== MAV_MISSION_ACCEPTED) {
          fail(`vehicle rejected mission pull (MAV_MISSION_RESULT=${type})`)
          return true
        }

        return false
      }

      return false
    },

    /** Drives the retry/timeout budget. Returns whether it actually changed state
     * (a re-request or a failure) — a bare "still waiting" tick returns false. */
    tick(nowMs = now()) {
      if (awaitingSince === null) {
        return false
      }

      // Terminal states have nothing outstanding to retry — without this guard,
      // a completed/published/failed sync whose awaitingSince was never cleared
      // would look "overdue" to a poll loop that keeps ticking after completion,
      // and get spuriously retried into failure.
      if (status === 'complete' || status === 'published' || status === 'failed') {
        return false
      }

      const timeoutMs = status === 'requested' ? MISSION_COUNT_TIMEOUT_MS : MISSION_ITEM_TIMEOUT_MS
      if (nowMs - awaitingSince < timeoutMs) {
        return false
      }

      // Consume every timeout period that has genuinely elapsed since the last
      // request, not just one, so a tick() call arriving late (a slow poll loop,
      // a busy process) reflects real elapsed time immediately instead of only
      // ever burning a single retry per call — otherwise catching up on a long
      // gap would take many more poll intervals than the retry budget allows.
      while (nowMs - awaitingSince >= timeoutMs) {
        retryCount += 1
        if (retryCount > MAX_RETRIES) {
          const waitingFor = status === 'requested' ? 'MISSION_COUNT' : `MISSION_ITEM_INT(seq=${nextSeq})`
          fail(`timed out waiting for ${waitingFor} after ${MAX_RETRIES} retries`)
          return true
        }
        awaitingSince += timeoutMs
      }

      if (status === 'requested') {
        sendRequestList()
      } else if (status === 'collecting') {
        sendRequestItem(nextSeq)
      }

      return true
    },

    /** Call once the router has actually broadcast a 'complete' snapshot. */
    acknowledgePublished() {
      if (status === 'complete') {
        status = 'published'
      }
    },

    getState() {
      return {
        status,
        reason,
        items: items.filter((item) => item !== undefined),
        activeIndex,
      }
    },
  }
}
