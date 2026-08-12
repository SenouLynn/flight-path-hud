import assert from 'node:assert/strict'
import test from 'node:test'
import { createSystemRoutes } from './systemRoutes.js'

test('each system keeps its own return endpoint even when another system reports last', () => {
  const routes = createSystemRoutes()
  routes.remember(1, 1, '127.0.0.1:40001', 10)
  routes.remember(2, 1, '127.0.0.1:40002', 20) // Plane is the latest sender.

  assert.equal(routes.sourceFor(1, 1), '127.0.0.1:40001')
  assert.equal(routes.sourceFor(2, 1), '127.0.0.1:40002')
})

test('refreshing a system changes only its own route', () => {
  const routes = createSystemRoutes()
  routes.remember(1, 1, '127.0.0.1:40001', 10)
  routes.remember(2, 1, '127.0.0.1:40002', 20)
  routes.remember(1, 1, '127.0.0.1:40003', 30)

  assert.equal(routes.sourceFor(1, 1), '127.0.0.1:40003')
  assert.equal(routes.sourceFor(2, 1), '127.0.0.1:40002')
})

test('stale and unknown systems have no route and cannot fall back to another vehicle', () => {
  const routes = createSystemRoutes()
  routes.remember(1, 1, '127.0.0.1:40001', 10)
  routes.remember(2, 1, '127.0.0.1:40002', 20)
  routes.expire(10, 31)

  assert.equal(routes.sourceFor(1, 1), null)
  assert.equal(routes.sourceFor(2, 1), null)
  assert.equal(routes.sourceFor(9, 1), null)
  assert.deepEqual([...routes.sources()], [])
})
