import dgram from 'node:dgram'
import { createSystemRoutes } from './systemRoutes.js'

/**
 * Inbound adapter: MAVLink datagrams off a UDP socket. Also the bridge's only
 * outbound path (see ADR-0027). Routes are deliberately per MAVLink system,
 * never "the last UDP sender": on a mixed fleet the latter can deliver a Plane
 * mission request to a Copter simply because the Copter reported most recently.
 */
export function createUdpIngress({ host, port }) {
  let socket = null
  const endpointsBySource = new Map()
  const routes = createSystemRoutes()

  const sourceKey = (address, remotePort) => `${address}:${remotePort}`

  return {
    describe: () => `udp ${host}:${port}`,

    start(onDatagram) {
      socket = dgram.createSocket('udp4')

      socket.on('message', (msg, rinfo) => {
        const source = sourceKey(rinfo.address, rinfo.port)
        endpointsBySource.set(source, { address: rinfo.address, port: rinfo.port })
        onDatagram(msg, { source })
      })

      socket.on('error', (err) => {
        console.error(`[mavlink-bridge] UDP error: ${err.message}`)
      })

      socket.bind(port, host, () => {
        console.log(`[mavlink-bridge] udp listening on ${host}:${port}`)
      })

      return () => {
        socket.close()
        socket = null
      }
    },

    /** Associate a decoded system with the endpoint that emitted its frame. */
    rememberSystem(sysId, compId, source) {
      if (!endpointsBySource.has(source)) {
        return false
      }
      routes.remember(sysId, compId, source, Date.now())
      return true
    },

    /** Forget routes not refreshed within the bridge's normal system TTL. */
    expireRoutes(maxAgeMs, nowMs = Date.now()) {
      routes.expire(maxAgeMs, nowMs)
      // An endpoint is useful only while at least one live system routes to it.
      // Otherwise a scanner or a succession of short-lived vehicles could leave
      // this UDP adapter accumulating remote address entries forever.
      const liveSources = routes.sources()
      endpointsBySource.forEach((_, source) => {
        if (!liveSources.has(source)) endpointsBySource.delete(source)
      })
    },

    hasRoute(sysId, compId) {
      const source = routes.sourceFor(sysId, compId)
      return source !== null && endpointsBySource.has(source)
    },

    /** Returns false (and sends nothing) when this system has no known endpoint. */
    sendTo(sysId, compId, buffer) {
      const source = routes.sourceFor(sysId, compId)
      const endpoint = source === null ? undefined : endpointsBySource.get(source)
      if (socket === null || endpoint === undefined) {
        return false
      }

      socket.send(buffer, endpoint.port, endpoint.address)
      return true
    },
  }
}
