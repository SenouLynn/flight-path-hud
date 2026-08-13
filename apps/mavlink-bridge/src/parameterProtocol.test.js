import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import { decodeParameterRequestRead, encodeParameterRequestList, encodeParameterRequestRead, encodeParameterSet } from './parameterProtocol.js'

test('list request is a CRC-correct exact-target MAVLink frame', () => {
  const frame = encodeParameterRequestList({ sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1 })
  assert.equal(frame[5], 21)
  assert.deepEqual([...frame.subarray(6, 8)], [2, 1])
  assert.equal(frame.readUInt16LE(8), computeFrameCrc(frame, 1, 8, 159))
})

test('name lookup encodes an exact target and MAVLink -1 index sentinel', () => {
  const frame = encodeParameterRequestRead({
    sysId: 255, compId: 190, targetSystemId: 2, targetComponentId: 1,
    name: 'ARSPD_FBW_MIN', index: -1,
  })
  assert.deepEqual(decodeParameterRequestRead(frame), {
    targetSystem: 2, targetComponent: 1, index: -1, name: 'ARSPD_FBW_MIN',
  })
})

test('index lookup leaves param_id empty', () => {
  const frame = encodeParameterRequestRead({
    sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, index: 42,
  })
  assert.deepEqual(decodeParameterRequestRead(frame), {
    targetSystem: 1, targetComponent: 1, index: 42, name: '',
  })
})

test('codec rejects ambiguous or non-portable selectors', () => {
  const base = { sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 }
  assert.throws(() => encodeParameterRequestRead({ ...base, name: 'FOO', index: 2 }), /index -1/)
  assert.throws(() => encodeParameterRequestRead({ ...base, name: 'PARAMETER_NAME_TOO_LONG', index: -1 }), /16 bytes/)
  assert.throws(() => encodeParameterRequestRead({ ...base, name: 'TEMP_°', index: -1 }), /ASCII/)
  assert.throws(() => encodeParameterRequestRead({ ...base, index: -1 }), /0-32767/)
})

test('decoder rejects a damaged request CRC', () => {
  const frame = encodeParameterRequestRead({
    sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, index: 3,
  })
  frame[10] ^= 0xFF
  assert.equal(decodeParameterRequestRead(frame), null)
})

test('PARAM_SET encodes exact target, bounded name, value and type with valid CRC', () => {
  const frame=encodeParameterSet({sysId:255,compId:190,targetSystemId:2,targetComponentId:1,name:'LOG_DISARMED',value:1,paramType:2})
  const payload=frame.subarray(6);assert.equal(frame[5],23);assert.equal(payload.readFloatLE(0),1)
  assert.deepEqual([...payload.subarray(4,6)],[2,1]);assert.equal(payload.toString('ascii',6,18),'LOG_DISARMED');assert.equal(payload[22],2)
  assert.equal(frame.readUInt16LE(29),computeFrameCrc(frame,1,29,168))
})
