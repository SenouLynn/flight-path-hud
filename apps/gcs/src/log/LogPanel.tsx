/**
 * Live view of the raw message stream.
 *
 * Formatting lives in gcs-core (`describeSample`); this is only presentation and
 * scroll behaviour. Clearing is a view-level cursor rather than a mutation of the
 * feed, so the underlying buffer stays intact for anything else reading it.
 */

import { logMessageNames, type LogEntry } from '@flight-path-hud/gcs-core'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

interface LogPanelProps {
  entries: LogEntry[]
}

/**
 * Rows actually mounted. The buffer holds more, but the view auto-scrolls to the
 * newest, so mounting all of them only costs diffing — and this panel shares a
 * main thread with the map's pan and tile work.
 */
const RENDER_WINDOW = 200

function formatClock(timestampMs: number): string {
  const date = new Date(timestampMs)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

/**
 * Memoised because the parent re-renders on every telemetry frame (~33 Hz) while
 * the log itself only publishes every 150 ms. Without this the whole table is
 * re-diffed per frame and the map janks — the panels are isolated in React, but
 * they are not isolated from each other's main-thread cost.
 */
export const LogPanel = memo(function LogPanel({ entries }: LogPanelProps) {
  const [paused, setPaused] = useState(false)
  const [messageFilter, setMessageFilter] = useState('')
  const [clearedBeforeId, setClearedBeforeId] = useState(0)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  // Frozen copy so pausing holds the view still while the feed keeps running.
  const frozenRef = useRef<LogEntry[]>(entries)

  if (!paused) {
    frozenRef.current = entries
  }
  const source = paused ? frozenRef.current : entries

  const names = useMemo(() => logMessageNames(source), [source])

  const matching = useMemo(() => source.filter((entry) => (
    entry.id > clearedBeforeId
    && (messageFilter === '' || entry.messageName === messageFilter)
  )), [source, clearedBeforeId, messageFilter])

  const visible = useMemo(
    () => (matching.length > RENDER_WINDOW ? matching.slice(matching.length - RENDER_WINDOW) : matching),
    [matching],
  )

  // Stick to the newest row unless the operator has scrolled up to read.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element === null || !stickToBottomRef.current) {
      return
    }

    element.scrollTop = element.scrollHeight
  }, [visible])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) {
      return
    }

    const onScroll = () => {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
      stickToBottomRef.current = distanceFromBottom < 24
    }

    element.addEventListener('scroll', onScroll)
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="log-panel">
      <header className="log-header">
        <span className="log-title">MAVLink stream</span>

        <select
          value={messageFilter}
          onChange={(event) => setMessageFilter(event.target.value)}
          aria-label="Filter by message"
        >
          <option value="">All messages</option>
          {names.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <span className="log-count">
          {matching.length > RENDER_WINDOW ? `last ${RENDER_WINDOW} of ${matching.length}` : `${matching.length} shown`}
        </span>

        <button
          type="button"
          className={paused ? 'segment active' : 'segment'}
          onClick={() => setPaused((previous) => !previous)}
          aria-pressed={paused}
        >
          {paused ? 'Paused' : 'Pause'}
        </button>

        <button
          type="button"
          className="segment"
          onClick={() => setClearedBeforeId(source.at(-1)?.id ?? 0)}
        >
          Clear
        </button>
      </header>

      <div className="log-rows" ref={scrollRef}>
        {visible.length === 0 ? (
          <p className="log-empty">No messages yet.</p>
        ) : visible.map((entry) => (
          <div key={entry.id} className={entry.kind === 'decode-error' ? 'log-row error' : 'log-row'}>
            <span className="log-time">{formatClock(entry.recvTimestampMs)}</span>
            <span className="log-sys">{entry.sysId}:{entry.compId}</span>
            <span className="log-name">{entry.messageName}</span>
            <span className="log-seq">#{entry.sequence}</span>
            <span className="log-summary">{entry.summary}</span>
          </div>
        ))}
      </div>
    </div>
  )
})
