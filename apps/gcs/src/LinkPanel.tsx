/**
 * The telemetry link: where to connect, and whether it is working.
 *
 * Shared by both views' sidebars. The fleet view is where the app opens, so
 * without this there the operator could land on an empty roster with no way to
 * see that the URL is wrong, let alone fix it.
 */

import type { ConnectionState } from '@flight-path-hud/gcs-core'

interface LinkPanelProps {
  url: string
  onUrlChange: (url: string) => void
  connectionState: ConnectionState
  frameCount: number
  decodeErrorCount: number
}

export function LinkPanel({
  url,
  onUrlChange,
  connectionState,
  frameCount,
  decodeErrorCount,
}: LinkPanelProps) {
  return (
    <section className="panel">
      <h2>Link</h2>
      <label className="control">
        <span>WebSocket URL</span>
        <input value={url} onChange={(event) => onUrlChange(event.target.value)} spellCheck={false} />
      </label>
      <div className="stat">
        <span>Connection</span>
        <strong className={`connection-state ${connectionState}`}>{connectionState}</strong>
      </div>
      <div className="stat"><span>Frames</span><strong>{frameCount}</strong></div>
      <div className="stat"><span>Decode errors</span><strong>{decodeErrorCount}</strong></div>
    </section>
  )
}
