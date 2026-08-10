import { describe, expect, it } from 'vitest'
import { MAVLINK_FIELDS, MAVLINK_FIELD_KEYS } from './mavlinkInputs'

describe('MAVLINK_FIELDS', () => {
  it('exports one key list entry per dictionary field', () => {
    expect(MAVLINK_FIELD_KEYS).toHaveLength(Object.keys(MAVLINK_FIELDS).length)
  })

  it('uses canonical uppercase keys', () => {
    for (const key of MAVLINK_FIELD_KEYS) {
      expect(key).toMatch(/^[A-Z0-9_]+$/)
    }
  })

  it('contains only non-empty message and field names', () => {
    for (const key of MAVLINK_FIELD_KEYS) {
      const entry = MAVLINK_FIELDS[key]

      expect(entry.message.length).toBeGreaterThan(0)
      expect(entry.field.length).toBeGreaterThan(0)
      expect(entry.notes.length).toBeGreaterThan(0)
    }
  })

  it('includes required attitude and vfr_hud sources', () => {
    expect(MAVLINK_FIELDS.ATTITUDE_ROLL).toBeDefined()
    expect(MAVLINK_FIELDS.ATTITUDE_PITCH).toBeDefined()
    expect(MAVLINK_FIELDS.ATTITUDE_YAW).toBeDefined()
    expect(MAVLINK_FIELDS.VFR_HUD_HEADING).toBeDefined()
  })
})
