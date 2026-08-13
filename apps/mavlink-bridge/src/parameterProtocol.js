import { buildMavlinkV1Frame, computeFrameCrc } from './mavlinkFrame.js'

export const PARAM_REQUEST_READ_MSG_ID = 20
export const PARAM_REQUEST_LIST_MSG_ID = 21
export const PARAM_VALUE_MSG_ID = 22
const PARAM_REQUEST_READ_CRC_EXTRA = 214
const PARAM_REQUEST_LIST_CRC_EXTRA = 159
const PARAM_ID_LENGTH = 16
let outboundSequence = 0

function encodeParamId(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('parameter name must not be empty')
  if (!/^[\x20-\x7E]+$/.test(value)) throw new Error('parameter name must contain printable ASCII only')
  const encoded = Buffer.from(value, 'ascii')
  if (encoded.length > PARAM_ID_LENGTH) throw new Error('parameter name exceeds 16 bytes')
  const field = Buffer.alloc(PARAM_ID_LENGTH)
  encoded.copy(field)
  return field
}

/** Encode the read-only MAVLink PARAM_REQUEST_READ transaction opener. */
export function encodeParameterRequestRead({
  sysId, compId, targetSystemId, targetComponentId, name = null, index = -1,
}) {
  const byName = name !== null
  if (byName && index !== -1) throw new Error('name lookup requires index -1')
  if (!byName && (!Number.isInteger(index) || index < 0 || index > 32767)) {
    throw new Error('index lookup requires an integer in the range 0-32767')
  }
  const payload = Buffer.alloc(20)
  payload.writeInt16LE(byName ? -1 : index, 0)
  payload.writeUInt8(targetSystemId, 2)
  payload.writeUInt8(targetComponentId, 3)
  if (byName) encodeParamId(name).copy(payload, 4)
  outboundSequence = (outboundSequence + 1) % 256
  return buildMavlinkV1Frame(PARAM_REQUEST_READ_MSG_ID, payload, {
    sequence: outboundSequence, sysId, compId, crcExtra: PARAM_REQUEST_READ_CRC_EXTRA,
  })
}

export function encodeParameterRequestList({ sysId, compId, targetSystemId, targetComponentId }) {
  const payload = Buffer.from([targetSystemId, targetComponentId])
  outboundSequence = (outboundSequence + 1) % 256
  return buildMavlinkV1Frame(PARAM_REQUEST_LIST_MSG_ID, payload, {
    sequence: outboundSequence, sysId, compId, crcExtra: PARAM_REQUEST_LIST_CRC_EXTRA,
  })
}

/** Test/support decoder for the one outbound message above. */
export function decodeParameterRequestRead(datagram) {
  if (datagram.length < 28 || datagram[0] !== 0xFE || datagram[5] !== PARAM_REQUEST_READ_MSG_ID || datagram[1] !== 20) return null
  const expected = datagram.readUInt16LE(26)
  if (computeFrameCrc(datagram, 1, 26, PARAM_REQUEST_READ_CRC_EXTRA) !== expected) return null
  const payload = datagram.subarray(6, 26)
  const terminator = payload.indexOf(0, 4)
  const end = terminator === -1 ? 20 : terminator
  return {
    targetSystem: payload.readUInt8(2), targetComponent: payload.readUInt8(3),
    index: payload.readInt16LE(0), name: payload.toString('ascii', 4, end),
  }
}
