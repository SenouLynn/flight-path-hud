

//CANNONICAL MAVLINK VARIABLE DETAILS FOR EXPECTED ALGORITHM INPUTS
/** The four telemetry sections a MAVLink field can land in. */
export type SampleSection = 'attitude' | 'vfrHud' | 'globalPositionInt' | 'gpsRawInt'

export interface MavlinkField {
  message: string
  field: string
  units: string
  valueType: 'float' | 'int16' | 'uint16' | 'int32'
  notes: string
  /**
   * Where the field lands in `TelemetrySample`. Absent when the harness does not
   * model the message yet (AIRSPEED, ODOMETRY), which is what lets a reader tell
   * "no value seen" apart from "not wired up".
   */
  sample?: { section: SampleSection, key: string }
}


export const MAVLINK_FIELDS: Record<string, MavlinkField> = {
  ATTITUDE_ROLL: {
    message: 'ATTITUDE',
    field: 'roll',
    units: 'rad',
    valueType: 'float',
    notes: 'Vehicle roll angle',
    sample: { section: 'attitude', key: 'rollRad' },
  },
  ATTITUDE_PITCH: {
    message: 'ATTITUDE',
    field: 'pitch',
    units: 'rad',
    valueType: 'float',
    notes: 'Vehicle pitch angle',
    sample: { section: 'attitude', key: 'pitchRad' },
  },
  ATTITUDE_YAW: {
    message: 'ATTITUDE',
    field: 'yaw',
    units: 'rad',
    valueType: 'float',
    notes: 'Vehicle yaw angle',
    sample: { section: 'attitude', key: 'yawRad' },
  },
  ATTITUDE_YAWSPEED: {
    message: 'ATTITUDE',
    field: 'yawspeed',
    units: 'rad/s',
    valueType: 'float',
    notes: 'Yaw angular rate',
    sample: { section: 'attitude', key: 'yawSpeedRadPerSec' },
  },
  ATTITUDE_PITCHSPEED: {
    message: 'ATTITUDE',
    field: 'pitchspeed',
    units: 'rad/s',
    valueType: 'float',
    notes: 'Pitch angular rate',
    sample: { section: 'attitude', key: 'pitchSpeedRadPerSec' },
  },
  VFR_HUD_HEADING: {
    message: 'VFR_HUD',
    field: 'heading',
    units: 'deg',
    valueType: 'int16',
    notes: 'Compass heading',
    sample: { section: 'vfrHud', key: 'headingDeg' },
  },
  VFR_HUD_AIRSPEED: {
    message: 'VFR_HUD',
    field: 'airspeed',
    units: 'm/s',
    valueType: 'float',
    notes: 'Airspeed estimate',
    sample: { section: 'vfrHud', key: 'airSpeedMps' },
  },
  VFR_HUD_GROUNDSPEED: {
    message: 'VFR_HUD',
    field: 'groundspeed',
    units: 'm/s',
    valueType: 'float',
    notes: 'Groundspeed estimate',
    sample: { section: 'vfrHud', key: 'groundSpeedMps' },
  },
  VFR_HUD_CLIMB: {
    message: 'VFR_HUD',
    field: 'climb',
    units: 'm/s',
    valueType: 'float',
    notes: 'Positive up climb rate',
    sample: { section: 'vfrHud', key: 'climbMps' },
  },
  AIRSPEED_AIRSPEED: {
    message: 'AIRSPEED',
    field: 'airspeed',
    units: 'm/s',
    valueType: 'float',
    notes: 'Differential-pressure-based airspeed',
  },
  GPS_RAW_INT_COG: {
    message: 'GPS_RAW_INT',
    field: 'cog',
    units: 'cdeg',
    valueType: 'uint16',
    notes: 'Course over ground',
    sample: { section: 'gpsRawInt', key: 'cogCdeg' },
  },
  GPS_RAW_INT_VEL: {
    message: 'GPS_RAW_INT',
    field: 'vel',
    units: 'cm/s',
    valueType: 'uint16',
    notes: 'Ground speed over 2D ground plane',
    sample: { section: 'gpsRawInt', key: 'velCms' },
  },
  GLOBAL_POSITION_INT_HDG: {
    message: 'GLOBAL_POSITION_INT',
    field: 'hdg',
    units: 'cdeg',
    valueType: 'uint16',
    notes: 'Compass heading; 65535 means unknown',
    sample: { section: 'globalPositionInt', key: 'headingCdeg' },
  },
  GLOBAL_POSITION_INT_VX: {
    message: 'GLOBAL_POSITION_INT',
    field: 'vx',
    units: 'cm/s',
    valueType: 'int16',
    notes: 'Ground X speed (North)',
    sample: { section: 'globalPositionInt', key: 'vxCms' },
  },
  GLOBAL_POSITION_INT_VY: {
    message: 'GLOBAL_POSITION_INT',
    field: 'vy',
    units: 'cm/s',
    valueType: 'int16',
    notes: 'Ground Y speed (East)',
    sample: { section: 'globalPositionInt', key: 'vyCms' },
  },
  GLOBAL_POSITION_INT_VZ: {
    message: 'GLOBAL_POSITION_INT',
    field: 'vz',
    units: 'cm/s',
    valueType: 'int16',
    notes: 'Ground Z speed (Down)',
    sample: { section: 'globalPositionInt', key: 'vzCms' },
  },
  GLOBAL_POSITION_INT_LAT: {
    message: 'GLOBAL_POSITION_INT',
    field: 'lat',
    units: 'degE7',
    valueType: 'int32',
    notes: 'Latitude, degrees × 1e7',
    sample: { section: 'globalPositionInt', key: 'latDegE7' },
  },
  GLOBAL_POSITION_INT_LON: {
    message: 'GLOBAL_POSITION_INT',
    field: 'lon',
    units: 'degE7',
    valueType: 'int32',
    notes: 'Longitude, degrees × 1e7',
    sample: { section: 'globalPositionInt', key: 'lonDegE7' },
  },
  GLOBAL_POSITION_INT_ALT: {
    message: 'GLOBAL_POSITION_INT',
    field: 'alt',
    units: 'mm',
    valueType: 'int32',
    notes: 'Altitude MSL (positive up)',
    sample: { section: 'globalPositionInt', key: 'altMm' },
  },
  GLOBAL_POSITION_INT_RELATIVE_ALT: {
    message: 'GLOBAL_POSITION_INT',
    field: 'relative_alt',
    units: 'mm',
    valueType: 'int32',
    notes: 'Altitude above home (positive up)',
    sample: { section: 'globalPositionInt', key: 'relativeAltMm' },
  },
  ODOMETRY_YAWSPEED: {
    message: 'ODOMETRY',
    field: 'yawspeed',
    units: 'rad/s',
    valueType: 'float',
    notes: 'Body yaw rate',
  },
  ODOMETRY_PITCHSPEED: {
    message: 'ODOMETRY',
    field: 'pitchspeed',
    units: 'rad/s',
    valueType: 'float',
    notes: 'Body pitch rate',
  },
}

export const MAVLINK_FIELD_KEYS = Object.keys(MAVLINK_FIELDS)