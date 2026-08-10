/**
 * Fixed parameter table — Mission Planner style. Rows are the full set of
 * modelled MAVLink fields and never reorder; only values change as messages
 * arrive, so the eye can stay on one row and watch it.
 *
 * Row construction and formatting live in gcs-core; this is presentation only.
 */

import {
  formatParameterValue,
  parameterMessages,
  readParameters,
  type TelemetrySample,
} from '@flight-path-hud/gcs-core'
import { memo, useMemo, useState } from 'react'

interface ParametersPanelProps {
  sample: TelemetrySample | null
}

export const ParametersPanel = memo(function ParametersPanel({ sample }: ParametersPanelProps) {
  const [messageFilter, setMessageFilter] = useState('')

  const rows = useMemo(() => readParameters(sample), [sample])
  const messages = useMemo(() => parameterMessages(rows), [rows])
  const visible = messageFilter === '' ? rows : rows.filter((row) => row.message === messageFilter)
  const liveCount = rows.filter((row) => row.value !== null).length

  return (
    <div className="param-panel">
      <header className="log-header">
        <select
          value={messageFilter}
          onChange={(event) => setMessageFilter(event.target.value)}
          aria-label="Filter by message"
        >
          <option value="">All messages</option>
          {messages.map((message) => (
            <option key={message} value={message}>{message}</option>
          ))}
        </select>
        <span className="log-count">{liveCount}/{rows.length} receiving</span>
      </header>

      <div className="param-grid">
        {visible.map((row) => (
          <div key={row.id} className={row.value === null ? 'param-cell stale' : 'param-cell'} title={row.notes}>
            <span className="param-name">
              <span className="param-msg">{row.message}</span>
              <span className="param-field">{row.field}</span>
            </span>
            <span className="param-value">
              {formatParameterValue(row.value, row.units)}
              <span className="param-units">{row.units}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})
