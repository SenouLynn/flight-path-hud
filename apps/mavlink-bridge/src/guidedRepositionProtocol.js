import { buildMavlinkV1Frame } from './mavlinkFrame.js'

export const MAV_CMD_DO_REPOSITION = 192
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6
export const MAV_DO_REPOSITION_FLAGS_NONE = 0
export const MAV_TYPE_FIXED_WING = 1
export const MAV_TYPE_QUADROTOR = 2

const MAVLINK_COMMAND_INT_MESSAGE_ID = 75
const MAVLINK_COMMAND_INT_CRC_EXTRA = 158
const validId = (value) => Number.isInteger(value) && value > 0 && value <= 255
let sequence = 0

function scaledCoordinate(value, scale, minimum, maximum, name) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`invalid ${name}`)
  return Math.round(value * scale)
}

/**
 * Encode one position-only Guided reposition command in an explicit relative-to-home frame.
 * Mode changes, velocity/attitude streaming, implicit defaults, and COMMAND_LONG coordinates
 * are deliberately outside this portable primitive.
 */
export function encodeGuidedReposition({ sysId, compId, targetSystemId, targetComponentId,
  latitudeDeg, longitudeDeg, relativeAltitudeM, vehicleType, loiterRadiusM, loiterDirection } = {}) {
  if (![sysId, compId, targetSystemId, targetComponentId].every(validId)) throw new Error('invalid source or target id')
  if (!Number.isFinite(relativeAltitudeM)) throw new Error('invalid relativeAltitudeM')
  if (vehicleType !== MAV_TYPE_QUADROTOR && vehicleType !== MAV_TYPE_FIXED_WING) throw new Error('unsupported vehicleType')

  let radius = 0
  let yaw = Number.NaN
  if (vehicleType === MAV_TYPE_QUADROTOR) {
    if (loiterRadiusM !== undefined || loiterDirection !== undefined) throw new Error('Copter reposition does not accept Plane loiter controls')
  } else {
    if (!Number.isFinite(loiterRadiusM) || loiterRadiusM <= 0) throw new Error('Plane requires a positive loiterRadiusM')
    if (loiterDirection !== 'clockwise' && loiterDirection !== 'counterclockwise') throw new Error('Plane requires an explicit loiterDirection')
    radius = loiterRadiusM
    yaw = loiterDirection === 'clockwise' ? 0 : 1
  }

  const payload = Buffer.alloc(35)
  payload.writeFloatLE(-1, 0) // default groundspeed
  payload.writeFloatLE(MAV_DO_REPOSITION_FLAGS_NONE, 4) // never change mode implicitly
  payload.writeFloatLE(radius, 8)
  payload.writeFloatLE(yaw, 12)
  payload.writeInt32LE(scaledCoordinate(latitudeDeg, 1e7, -90, 90, 'latitudeDeg'), 16)
  payload.writeInt32LE(scaledCoordinate(longitudeDeg, 1e7, -180, 180, 'longitudeDeg'), 20)
  payload.writeFloatLE(relativeAltitudeM, 24)
  payload.writeUInt16LE(MAV_CMD_DO_REPOSITION, 28)
  payload.writeUInt8(targetSystemId, 30)
  payload.writeUInt8(targetComponentId, 31)
  payload.writeUInt8(MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, 32)
  payload.writeUInt8(0, 33) // not a mission item
  payload.writeUInt8(0, 34) // not a mission item
  sequence = (sequence + 1) & 0xff
  return buildMavlinkV1Frame(MAVLINK_COMMAND_INT_MESSAGE_ID, payload,
    { sequence, sysId, compId, crcExtra: MAVLINK_COMMAND_INT_CRC_EXTRA })
}
