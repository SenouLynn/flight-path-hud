import dgram from 'node:dgram'

/** Inbound adapter: MAVLink datagrams off a UDP socket. Also the bridge's only
 * outbound path (see ADR-0027) — `send()` replies to whichever remote endpoint
 * most recently sent a datagram, since UDP is connectionless and "the vehicle" is,
 * in practice, whoever we last heard from (the same address:port bridgeCore.js
 * already tracks to detect a duplicate transmitter). */
export function createUdpIngress({ host, port }) {
  let socket = null
  let lastRemote = null

  return {
    describe: () => `udp ${host}:${port}`,

    start(onDatagram) {
      socket = dgram.createSocket('udp4')

      socket.on('message', (msg, rinfo) => {
        lastRemote = { address: rinfo.address, port: rinfo.port }
        onDatagram(msg, { source: `${rinfo.address}:${rinfo.port}` })
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

    /** Returns false (and sends nothing) if no datagram has arrived yet — lets a
     * caller distinguish "nowhere to send" from "sent." */
    send(buffer) {
      if (socket === null || lastRemote === null) {
        return false
      }

      socket.send(buffer, lastRemote.port, lastRemote.address)
      return true
    },
  }
}
