import dgram from 'node:dgram'

/** Inbound adapter: MAVLink datagrams off a UDP socket. */
export function createUdpIngress({ host, port }) {
  return {
    describe: () => `udp ${host}:${port}`,

    start(onDatagram) {
      const socket = dgram.createSocket('udp4')

      socket.on('message', (msg, rinfo) => {
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
      }
    },
  }
}
