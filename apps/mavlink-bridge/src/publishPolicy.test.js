import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PUBLIC_RAW_MESSAGE_NAMES,
  ROUTED_ONLY_MESSAGE_NAMES,
  rawPublishDisposition,
} from './publishPolicy.js'

test('publishes exactly the eight protocol-v0 raw telemetry families', () => {
  assert.deepEqual(PUBLIC_RAW_MESSAGE_NAMES, [
    'HEARTBEAT', 'PARAM_VALUE', 'GPS_RAW_INT', 'ATTITUDE',
    'GLOBAL_POSITION_INT', 'VFR_HUD', 'COMMAND_ACK', 'GPS_GLOBAL_ORIGIN',
  ])
  PUBLIC_RAW_MESSAGE_NAMES.forEach((name) => assert.equal(rawPublishDisposition(name), 'raw'))
})

test('routes and suppresses exactly home plus the six mission families', () => {
  assert.deepEqual(ROUTED_ONLY_MESSAGE_NAMES, [
    'HOME_POSITION', 'MISSION_COUNT', 'MISSION_ITEM_INT', 'MISSION_CURRENT',
    'MISSION_ACK', 'MISSION_REQUEST', 'MISSION_REQUEST_INT',
  ])
  ROUTED_ONLY_MESSAGE_NAMES.forEach((name) => assert.equal(rawPublishDisposition(name), 'routed'))
})

test('unknown internal names are dropped rather than widening the public contract', () => {
  assert.equal(rawPublishDisposition('FUTURE_MESSAGE'), 'drop')
  assert.equal(rawPublishDisposition(undefined), 'drop')
})
