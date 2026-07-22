import { normalizeHeadingDegrees } from '../logic/heading'
import { type TelemetrySample } from '../logic/telemetry'

export type TelemetrySourceId = 'synthetic-replay' | 'live-mock'

export interface TelemetrySource {
  id: TelemetrySourceId
  label: string
  intervalMs: number
  start: (onSample: (sample: TelemetrySample) => void) => () => void
}

function speedToCms(speedMps: number): number {
  return speedMps * 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function buildMockLiveSample(timestampMs: number): TelemetrySample {
  const tSec = timestampMs / 1000

  const turnFrequencyRadPerSec = 0.35
  const turnPhase = turnFrequencyRadPerSec * tSec
  const headingAmplitudeDeg = 55

  const headingDeg = normalizeHeadingDegrees(180 + headingAmplitudeDeg * Math.sin(turnPhase))
  const rollRad = 0.45 * Math.cos(turnPhase)
  const pitchRad = Math.sin(tSec * 0.55) * 0.16
  const yawRad = ((headingDeg - 180) * Math.PI) / 180
  const yawSpeedRadPerSec = (headingAmplitudeDeg * Math.PI / 180) * turnFrequencyRadPerSec * Math.cos(turnPhase)

  const groundSpeedMps = 16 + Math.sin(tSec * 0.26) * 1.8
  const climbMps = Math.sin(tSec * 0.38) * 1.6
  const trackDeg = headingDeg + Math.sin(tSec * 0.22) * 6
  const trackRad = (trackDeg * Math.PI) / 180

  const vxCms = speedToCms(groundSpeedMps * Math.cos(trackRad))
  const vyCms = speedToCms(groundSpeedMps * Math.sin(trackRad))
  const vzCms = -speedToCms(clamp(climbMps, -3, 3))

  return {
    timestampMs,
    attitude: {
      rollRad,
      pitchRad,
      yawRad,
      yawSpeedRadPerSec,
    },
    vfrHud: {
      headingDeg,
      groundSpeedMps,
      climbMps,
    },
    globalPositionInt: {
      headingCdeg: headingDeg * 100,
      vxCms,
      vyCms,
      vzCms,
    },
    gpsRawInt: {
      cogCdeg: normalizeHeadingDegrees((trackRad * 180) / Math.PI) * 100,
      velCms: speedToCms(groundSpeedMps),
    },
  }
}

export function createSyntheticReplaySource(
  samples: TelemetrySample[],
  intervalMs = 250,
): TelemetrySource {
  return {
    id: 'synthetic-replay',
    label: 'Synthetic replay',
    intervalMs,
    start: (onSample) => {
      if (samples.length === 0) {
        return () => undefined
      }

      let index = 0
      const emitCurrent = () => {
        const current = samples[index]
        onSample({
          ...current,
          timestampMs: Date.now(),
        })
        index = (index + 1) % samples.length
      }

      emitCurrent()
      const timer = setInterval(emitCurrent, intervalMs)

      return () => {
        clearInterval(timer)
      }
    },
  }
}

export function createLiveMockSource(intervalMs = 100): TelemetrySource {
  return {
    id: 'live-mock',
    label: 'Live stream (mock)',
    intervalMs,
    start: (onSample) => {
      const emitCurrent = () => {
        onSample(buildMockLiveSample(Date.now()))
      }

      emitCurrent()
      const timer = setInterval(emitCurrent, intervalMs)

      return () => {
        clearInterval(timer)
      }
    },
  }
}
