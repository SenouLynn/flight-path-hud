export const PUBLIC_RAW_MESSAGE_NAMES = Object.freeze([
  'HEARTBEAT',
  'PARAM_VALUE',
  'GPS_RAW_INT',
  'ATTITUDE',
  'GLOBAL_POSITION_INT',
  'VFR_HUD',
  'COMMAND_ACK',
  'GPS_GLOBAL_ORIGIN',
])

export const ROUTED_ONLY_MESSAGE_NAMES = Object.freeze([
  'HOME_POSITION',
  'MISSION_COUNT',
  'MISSION_ITEM_INT',
  'MISSION_CURRENT',
  'MISSION_ACK',
  'MISSION_REQUEST',
  'MISSION_REQUEST_INT',
])

const publicRawNames = new Set(PUBLIC_RAW_MESSAGE_NAMES)
const routedOnlyNames = new Set(ROUTED_ONLY_MESSAGE_NAMES)

/**
 * The normalization boundary accepts exactly fifteen message families. Eight
 * remain raw protocol-v0 telemetry; mission/home traffic is consumed by the
 * mission router and must never leak as a second public representation.
 *
 * `drop` is defensive. The strict ingress parser rejects unknown JSON message
 * names before the core, but this keeps a future internal producer from
 * accidentally widening the public WebSocket contract.
 */
export function rawPublishDisposition(messageName) {
  if (publicRawNames.has(messageName)) return 'raw'
  if (routedOnlyNames.has(messageName)) return 'routed'
  return 'drop'
}
