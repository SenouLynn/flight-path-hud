/**
 * Per-system return routes for a connectionless UDP ingress.
 *
 * Kept pure because the correctness rule is independent of sockets: outbound
 * MAVLink for `sysId:compId` must use the endpoint that last carried traffic for
 * that exact system, never an arbitrary recent sender.
 */
function systemKey(sysId, compId) {
  return `${sysId}:${compId}`
}

export function createSystemRoutes() {
  const routes = new Map()

  return {
    remember(sysId, compId, source, nowMs) {
      routes.set(systemKey(sysId, compId), { source, lastSeenMs: nowMs })
    },

    sourceFor(sysId, compId) {
      return routes.get(systemKey(sysId, compId))?.source ?? null
    },

    sources() {
      return new Set([...routes.values()].map((route) => route.source))
    },

    expire(maxAgeMs, nowMs) {
      routes.forEach((route, key) => {
        if (nowMs - route.lastSeenMs > maxAgeMs) routes.delete(key)
      })
    },
  }
}
