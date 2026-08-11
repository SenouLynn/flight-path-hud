import type { ExternalMessageRate, ExternalObservedSystem, ExternalTelemetryEnvelope } from './externalTypes'

export type StopSubscription = () => void

export interface TelemetryIngressPort {
  subscribe: (onEnvelope: (envelope: ExternalTelemetryEnvelope) => void) => StopSubscription
}

export interface GcsStreamPort {
  publish: (envelope: ExternalTelemetryEnvelope) => void
  subscribe: (onEnvelope: (envelope: ExternalTelemetryEnvelope) => void) => StopSubscription
}

export interface StreamHealthSnapshot {
  packetRateHz: number
  decodeErrorCount: number
  droppedPacketCount: number
  lastHeartbeatAgeMs: number
  connectionState: 'connecting' | 'open' | 'closed' | 'error'
  activeSysId?: number
  activeCompId?: number
  messageRates: ExternalMessageRate[]
  systems: ExternalObservedSystem[]
}

export interface StreamHealthPort {
  getSnapshot: () => StreamHealthSnapshot
  subscribe: (onSnapshot: (snapshot: StreamHealthSnapshot) => void) => StopSubscription
}

export function createInMemoryGcsStreamPort(): GcsStreamPort {
  const subscribers = new Set<(envelope: ExternalTelemetryEnvelope) => void>()

  return {
    publish: (envelope) => {
      subscribers.forEach((subscriber) => {
        subscriber(envelope)
      })
    },
    subscribe: (onEnvelope) => {
      subscribers.add(onEnvelope)
      return () => {
        subscribers.delete(onEnvelope)
      }
    },
  }
}
