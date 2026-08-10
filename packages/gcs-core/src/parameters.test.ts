import { describe, expect, it } from 'vitest'
import { formatParameterValue, parameterMessages, readParameters } from './parameters'

describe('readParameters', () => {
  it('returns the same rows whether or not any data has arrived', () => {
    // The table must not reflow as messages come in — that is the whole point of
    // a fixed parameter list rather than a log.
    const empty = readParameters(null)
    const populated = readParameters({ timestampMs: 1, attitude: { rollRad: 0.5 } })

    expect(empty.map((row) => row.id)).toEqual(populated.map((row) => row.id))
    expect(empty.length).toBeGreaterThan(0)
  })

  it('reads a value through the registry sample path', () => {
    const rows = readParameters({ timestampMs: 1, attitude: { rollRad: 0.5, pitchRad: -0.2 } })
    const roll = rows.find((row) => row.id === 'ATTITUDE_ROLL')

    expect(roll?.value).toBeCloseTo(0.5, 8)
    expect(roll?.units).toBe('rad')
    expect(roll?.message).toBe('ATTITUDE')
  })

  it('reports a null value for fields that have not arrived', () => {
    const rows = readParameters({ timestampMs: 1, attitude: { rollRad: 0.5 } })

    expect(rows.find((row) => row.id === 'VFR_HUD_AIRSPEED')?.value).toBeNull()
  })

  it('treats an explicit undefined from sanitizing as not received', () => {
    const rows = readParameters({ timestampMs: 1, vfrHud: { headingDeg: undefined, airSpeedMps: 18 } })

    expect(rows.find((row) => row.id === 'VFR_HUD_HEADING')?.value).toBeNull()
    expect(rows.find((row) => row.id === 'VFR_HUD_AIRSPEED')?.value).toBe(18)
  })

  it('excludes registry entries the harness does not model', () => {
    // AIRSPEED and ODOMETRY are registered but absent from TelemetrySample.
    const ids = readParameters(null).map((row) => row.id)

    expect(ids).not.toContain('AIRSPEED_AIRSPEED')
    expect(ids).not.toContain('ODOMETRY_YAWSPEED')
  })

  it('includes the GLOBAL_POSITION_INT heading the resolvers fall back to', () => {
    const rows = readParameters({ timestampMs: 1, globalPositionInt: { headingCdeg: 18000 } })

    expect(rows.find((row) => row.id === 'GLOBAL_POSITION_INT_HDG')?.value).toBe(18000)
  })

  it('is grouped by message then field for a stable reading order', () => {
    const messages = readParameters(null).map((row) => row.message)

    expect(messages).toEqual([...messages].sort())
  })
})

describe('parameterMessages', () => {
  it('lists the distinct messages in the table', () => {
    expect(parameterMessages(readParameters(null))).toEqual([
      'ATTITUDE',
      'GLOBAL_POSITION_INT',
      'GPS_RAW_INT',
      'VFR_HUD',
    ])
  })
})

describe('formatParameterValue', () => {
  it('shows an em dash when nothing has been received', () => {
    expect(formatParameterValue(null, 'rad')).toBe('—')
  })

  it('does not print decimals on integer-scaled MAVLink units', () => {
    expect(formatParameterValue(473977420.4, 'degE7')).toBe('473977420')
    expect(formatParameterValue(-1730.78, 'cm/s')).toBe('-1731')
    expect(formatParameterValue(18272.55, 'cdeg')).toBe('18273')
  })

  it('keeps angular resolution, where small values matter', () => {
    expect(formatParameterValue(0.00012, 'rad')).toBe('0.0001')
    expect(formatParameterValue(0.25, 'rad/s')).toBe('0.2500')
  })

  it('falls back to two decimals for everything else', () => {
    expect(formatParameterValue(17.327, 'm/s')).toBe('17.33')
  })
})
