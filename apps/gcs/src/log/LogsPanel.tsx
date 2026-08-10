/**
 * The parameters/raw-stream panel, as its own top-level view.
 *
 * Parameters lead because a fixed table is what gets read while flying; the raw
 * stream stays a tab behind it for validating what is actually on the wire.
 */

import type { LogEntry, TelemetrySample } from '@flight-path-hud/gcs-core'
import { useState } from 'react'
import { LogPanel } from './LogPanel'
import { ParametersPanel } from './ParametersPanel'

type LogsTab = 'parameters' | 'stream'

interface LogsPanelProps {
  sample: TelemetrySample | null
  log: LogEntry[]
}

export function LogsPanel({ sample, log }: LogsPanelProps) {
  const [tab, setTab] = useState<LogsTab>('parameters')

  return (
    <div className="logs-view">
      <div className="bottom-tabs">
        <button
          type="button"
          className={tab === 'parameters' ? 'segment active' : 'segment'}
          onClick={() => setTab('parameters')}
          aria-pressed={tab === 'parameters'}
        >
          Parameters
        </button>
        <button
          type="button"
          className={tab === 'stream' ? 'segment active' : 'segment'}
          onClick={() => setTab('stream')}
          aria-pressed={tab === 'stream'}
        >
          Raw stream
        </button>
      </div>

      {tab === 'parameters'
        ? <ParametersPanel sample={sample} />
        : <LogPanel entries={log} />}
    </div>
  )
}
