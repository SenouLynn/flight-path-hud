import { useEffect, useState } from 'react'
import type { TelemetrySample } from '../logic/telemetry'
import type { StreamHealthSnapshot } from './streamPorts'
import type { TelemetrySource } from './telemetrySource'

export interface TelemetryFeedState {
  latestSample: TelemetrySample | null
  packetCount: number
  streamHealth: StreamHealthSnapshot
}

interface TelemetryFeedInternalState {
  sourceId: string
  latestSample: TelemetrySample | null
  packetCount: number
  streamHealth: StreamHealthSnapshot
}

const DEFAULT_STREAM_HEALTH: StreamHealthSnapshot = {
  packetRateHz: 0,
  decodeErrorCount: 0,
  droppedPacketCount: 0,
  lastHeartbeatAgeMs: 0,
  connectionState: 'closed',
}

export function useTelemetryFeed(source: TelemetrySource): TelemetryFeedState {
  const [state, setState] = useState<TelemetryFeedInternalState>({
    sourceId: source.id,
    latestSample: null,
    packetCount: 0,
    streamHealth: DEFAULT_STREAM_HEALTH,
  })

  useEffect(() => {
    let packetCount = 0
    let streamHealth = DEFAULT_STREAM_HEALTH

    const stop = source.start(
      (sample) => {
        packetCount += 1
        setState({
          sourceId: source.id,
          latestSample: sample,
          packetCount,
          streamHealth,
        })
      },
      (snapshot) => {
        streamHealth = snapshot
        setState((prevState) => ({
          sourceId: source.id,
          latestSample: prevState.latestSample,
          packetCount,
          streamHealth,
        }))
      },
    )

    return stop
  }, [source])

  const isCurrentSource = state.sourceId === source.id

  return {
    latestSample: isCurrentSource ? state.latestSample : null,
    packetCount: isCurrentSource ? state.packetCount : 0,
    streamHealth: isCurrentSource ? state.streamHealth : DEFAULT_STREAM_HEALTH,
  }
}
