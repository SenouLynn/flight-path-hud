/**
 * A fixed parameter table over the live sample, in the spirit of Mission
 * Planner's status view: the rows never move, only the values change.
 *
 * Rows come from the canonical MAVLink field registry (ADR-0013), so the table
 * lists everything the harness knows about — including fields that have not
 * arrived yet, which is the point. A row reading "—" tells you a channel is
 * missing; a row that simply isn't there tells you nothing.
 */

import { MAVLINK_FIELDS, type MavlinkField } from '@flight-path-hud/hud-ui/constants/mavlinkInputs'
import type { TelemetrySample } from './wire'

export interface ParameterRow {
  /** Registry key, stable across renders — a good React key. */
  id: string
  message: string
  field: string
  units: string
  notes: string
  /** Null when the field has not been received, or is not modelled at all. */
  value: number | null
  /** False when the harness does not map this field into TelemetrySample. */
  modelled: boolean
}

/** Registry entries that map into a sample, ordered by message then field. */
const MODELLED_FIELDS: Array<[string, MavlinkField]> = Object.entries(MAVLINK_FIELDS)
  .filter(([, entry]) => entry.sample !== undefined)
  .sort(([, left], [, right]) => (
    left.message.localeCompare(right.message) || left.field.localeCompare(right.field)
  ))

function readValue(sample: TelemetrySample | null, entry: MavlinkField): number | null {
  if (sample === null || entry.sample === undefined) {
    return null
  }

  const section = sample[entry.sample.section] as Record<string, number | undefined> | undefined
  const value = section?.[entry.sample.key]

  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Every modelled field, present or not. The row set is constant for a given
 * registry, so the table does not reflow as messages arrive.
 */
export function readParameters(sample: TelemetrySample | null): ParameterRow[] {
  return MODELLED_FIELDS.map(([id, entry]) => ({
    id,
    message: entry.message,
    field: entry.field,
    units: entry.units,
    notes: entry.notes,
    value: readValue(sample, entry),
    modelled: true,
  }))
}

/** Message names in the table, for grouping or filtering. */
export function parameterMessages(rows: ParameterRow[]): string[] {
  return [...new Set(rows.map((row) => row.message))]
}

/**
 * Display precision by unit. Integer-scaled MAVLink units (degE7, mm, cm/s,
 * cdeg) are meaningless past the decimal point; angles and speeds are not.
 */
export function formatParameterValue(value: number | null, units: string): string {
  if (value === null) {
    return '—'
  }

  switch (units) {
    case 'degE7':
    case 'mm':
    case 'cm/s':
    case 'cdeg':
      return String(Math.round(value))
    case 'rad':
    case 'rad/s':
      return value.toFixed(4)
    default:
      return value.toFixed(2)
  }
}
