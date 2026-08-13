import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { parseIncomingDatagram } from './normalize.js'
import {
  encodeMissionClearAll, encodeMissionUploadCount, encodeMissionUploadItem, encodeMissionUploadItemInt,
} from './missionUploadProtocol.js'

function assertFrame(frame, messageId, crcExtra) {
  assert.equal(frame[0], 0xfe)
  assert.equal(frame[5], messageId)
  assert.equal(frame.readUInt16LE(frame.length - 2), computeFrameCrc(frame, 1, frame.length - 2, crcExtra))
}

test('mission replacement codecs produce CRC-correct exact-target frames', () => {
  const clear = encodeMissionClearAll({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1 })
  assertFrame(clear, 45, 232)
  assert.deepEqual([...clear.subarray(6, 8)], [2, 1])

  const count = encodeMissionUploadCount({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1, count: 3 })
  assertFrame(count, 44, 221)
  assert.equal(count.readUInt16LE(6), 3)
  assert.deepEqual([...count.subarray(8, 10)], [2, 1])

  const item = encodeMissionUploadItemInt({
    sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1,
    item: { seq: 1, command: 16, frameId: 3, current: false, autocontinue: true,
      param1: 1, param2: 2, param3: 3, param4: 4, latDegE7: 473977420, lonDegE7: 85455940, altM: 80 },
  })
  assertFrame(item, 73, 38)
  assert.equal(item.readUInt16LE(34), 1)
  assert.equal(item.readUInt16LE(36), 16)
  assert.deepEqual([...item.subarray(38, 43)], [2, 1, 3, 0, 1])
})

test('legacy MISSION_ITEM fallback carries float coordinates for MAVLink 1 peers', () => {
  const item = encodeMissionUploadItem({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1,
    item: { seq: 0, command: 16, frameId: 3, current: true, autocontinue: true,
      latDegE7: -353632610, lonDegE7: 1491652300, altM: 80 } })
  assertFrame(item, 39, 254)
  assert.ok(Math.abs(item.readFloatLE(22) - -35.363261) < 1e-5)
  assert.ok(Math.abs(item.readFloatLE(26) - 149.16523) < 1e-5)
  assert.deepEqual([...item.subarray(38, 43)], [2, 1, 3, 1, 1])
})

test('normalizer decodes an addressed MISSION_REQUEST_INT', () => {
  // The pull encoder has the same wire layout/CRC as a vehicle upload request.
  const request = Buffer.from([0xfe, 4, 9, 2, 1, 51, 7, 0, 255, 190, 0, 0])
  request.writeUInt16LE(computeFrameCrc(request, 1, 10, 196), 10)
  const { envelopes, decodeErrors } = parseIncomingDatagram(request, 1234)
  assert.equal(decodeErrors, 0)
  assert.deepEqual(envelopes[0].payload.missionRequestInt, { seq: 7, targetSystem: 255, targetComponent: 190 })
})

test('normalizer decodes the MAVLink 1 MISSION_REQUEST fallback', () => {
  const request = Buffer.from([0xfe, 4, 9, 2, 1, 40, 3, 0, 255, 190, 0, 0])
  request.writeUInt16LE(computeFrameCrc(request, 1, 10, 230), 10)
  const { envelopes } = parseIncomingDatagram(request, 1234)
  assert.deepEqual(envelopes[0].payload.missionRequest, { seq: 3, targetSystem: 255, targetComponent: 190 })
})
