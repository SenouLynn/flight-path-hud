import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'
import { createUdpIngress } from './udpIngress.js'

const TEST_HOST = '127.0.0.1'
const TEST_PORT = 19845 // arbitrary, loopback-only, unlikely to collide

/** Resend every 20ms until `promise` resolves — dodges the bind-race between the
 * ingress's socket coming up and the client's first send, without a fixed sleep. */
function sendUntil(client, buffer, port, host, promise) {
  const interval = setInterval(() => client.send(buffer, port, host), 20)
  return promise.finally(() => clearInterval(interval))
}

test('send() replies to whichever remote endpoint most recently sent a datagram', async () => {
  const ingress = createUdpIngress({ host: TEST_HOST, port: TEST_PORT })
  const client = dgram.createSocket('udp4')

  const receivedByIngress = new Promise((resolve) => {
    const stop = ingress.start((datagram, meta) => resolve({ datagram, meta, stop }))
  })

  await new Promise((resolve) => client.bind(0, TEST_HOST, resolve))
  const { stop } = await sendUntil(client, Buffer.from('hello'), TEST_PORT, TEST_HOST, receivedByIngress)

  const receivedByClient = new Promise((resolve) => client.once('message', resolve))
  const sent = ingress.send(Buffer.from('reply'))
  assert.equal(sent, true)

  const reply = await receivedByClient
  assert.equal(reply.toString(), 'reply')

  client.close()
  stop()
})

test('send() returns false when nothing has been received yet', () => {
  const ingress = createUdpIngress({ host: TEST_HOST, port: TEST_PORT + 1 })
  const stop = ingress.start(() => {})
  assert.equal(ingress.send(Buffer.from('x')), false)
  stop()
})
