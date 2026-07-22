import { useEffect, useState } from 'react'
import type { TelemetrySample } from '../logic/telemetry'
import type { TelemetrySource } from './telemetrySource'

export interface TelemetryFeedState {
  latestSample: TelemetrySample | null
  packetCount: number
}

interface TelemetryFeedInternalState {
  sourceId: string
  latestSample: TelemetrySample | null
  packetCount: number
}

export function useTelemetryFeed(source: TelemetrySource): TelemetryFeedState {
  const [state, setState] = useState<TelemetryFeedInternalState>({
    sourceId: source.id,
    latestSample: null,
    packetCount: 0,
  })

  useEffect(() => {
    let packetCount = 0

    const stop = source.start((sample) => {
      packetCount += 1
      setState({
        sourceId: source.id,
        latestSample: sample,
        packetCount,
      })
    })

    return stop
  }, [source])

  const isCurrentSource = state.sourceId === source.id

  return {
    latestSample: isCurrentSource ? state.latestSample : null,
    packetCount: isCurrentSource ? state.packetCount : 0,
  }
}
