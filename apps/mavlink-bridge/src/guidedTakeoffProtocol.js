import { buildMavlinkV1Frame } from './mavlinkFrame.js'

export const MAV_CMD_NAV_TAKEOFF = 22
let sequence = 0

/** Copter Guided takeoff. Altitude is relative to home in ArduPilot Guided mode. */
export function encodeGuidedTakeoff({ sysId, compId, targetSystemId, targetComponentId, relativeAltitudeM }) {
  if (!Number.isFinite(relativeAltitudeM) || relativeAltitudeM < 2 || relativeAltitudeM > 120) {
    throw new Error('relative takeoff altitude must be between 2 and 120 m')
  }
  const payload = Buffer.alloc(33)
  payload.writeFloatLE(relativeAltitudeM, 24) // COMMAND_LONG param7
  payload.writeUInt16LE(MAV_CMD_NAV_TAKEOFF, 28)
  payload.writeUInt8(targetSystemId, 30)
  payload.writeUInt8(targetComponentId, 31)
  sequence = (sequence + 1) & 0xff
  return buildMavlinkV1Frame(76, payload, { sequence, sysId, compId, crcExtra: 152 })
}
