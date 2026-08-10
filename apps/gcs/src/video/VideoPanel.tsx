/**
 * Video view: the stream plus the health an operator needs to trust it.
 *
 * The panel knows nothing about cameras or capture — only that some adapter can
 * mount a stream into a container and report statistics. Swapping MJPEG for WHEP
 * later changes the adapter, not this file.
 */

import {
  EMPTY_VIDEO_HEALTH_STATE,
  foldVideoHealth,
  setVideoConnectionState,
  type VideoHealth,
} from '@flight-path-hud/gcs-core'
import { useEffect, useMemo, useRef } from 'react'
import { createMjpegSource } from './mjpegSource'

export const DEFAULT_VIDEO_URL = 'http://localhost:8090/stream'

interface VideoPanelProps {
  url: string
  /** Health is surfaced in the sidebar, so it is reported upward. */
  onHealth: (health: VideoHealth) => void
  onSourceLabel: (label: string) => void
}

export function VideoPanel({ url, onHealth, onSourceLabel }: VideoPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const source = useMemo(() => createMjpegSource(url), [url])

  // Handlers read through a ref: the stream must not be rebuilt because a
  // parent re-rendered and produced new callback identities.
  const reportRef = useRef({ onHealth, onSourceLabel })
  reportRef.current = { onHealth, onSourceLabel }

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    let state = EMPTY_VIDEO_HEALTH_STATE
    reportRef.current.onSourceLabel(source.label)

    const stop = source.start(container, {
      onStats: (sample) => {
        state = foldVideoHealth(state, sample)
        reportRef.current.onHealth(state.health)
      },
      onConnectionState: (connectionState) => {
        state = setVideoConnectionState(state, connectionState)
        reportRef.current.onHealth(state.health)
      },
    })

    return () => {
      stop()
      reportRef.current.onHealth(EMPTY_VIDEO_HEALTH_STATE.health)
    }
  }, [source])

  // Stage only. URL and statistics live in the sidebar with the other readouts.
  return <div className="video-stage" ref={containerRef} />
}
