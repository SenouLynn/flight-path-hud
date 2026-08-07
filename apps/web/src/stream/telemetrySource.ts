import { normalizeHeadingDegrees } from '../logic/heading'
import { type TelemetrySample } from '../logic/telemetry'
import type { StreamHealthSnapshot } from './streamPorts'

export type TelemetrySourceId = 'synthetic-replay' | 'live-mock' | 'ws-external'

export interface TelemetrySource {
  id: TelemetrySourceId
  label: string
  intervalMs: number
  start: (
    onSample: (sample: TelemetrySample) => void,
    onHealthUpdate?: (snapshot: StreamHealthSnapshot) => void,
  ) => () => void
}

function speedToCms(speedMps: number): number {
  return speedMps * 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Equatorial meters per degree of latitude, matching logic/position.ts. Used
// only to invert an integrated ENU path back into plausible LLA fixes so the
// synthetic mission carries an absolute GPS track (exercises the lla_enu path).
const METERS_PER_DEG_LAT = 111319.49
const DEG_E7 = 1e7
// Arbitrary launch point (Zürich-ish) at 500 m MSL — the ENU frame origin.
const MOCK_ORIGIN = { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 }

export function buildMockLiveSample(timestampMs: number): TelemetrySample {
  const tSec = timestampMs / 1000

  const turnFrequencyRadPerSec = 0.35
  const turnPhase = turnFrequencyRadPerSec * tSec
  const headingAmplitudeDeg = 55

  const pitchFrequencyRadPerSec = 0.55
  const pitchAmplitudeRad = 0.16

  const headingDeg = normalizeHeadingDegrees(180 + headingAmplitudeDeg * Math.sin(turnPhase))
  const rollRad = 0.45 * Math.cos(turnPhase)
  const pitchRad = pitchAmplitudeRad * Math.sin(tSec * pitchFrequencyRadPerSec)
  const yawRad = ((headingDeg - 180) * Math.PI) / 180

  // Analytic EARTH-frame rates of the synthesized motion: derivatives of the
  // heading and pitch angles above.
  const headingRateRadPerSec = (headingAmplitudeDeg * Math.PI / 180) * turnFrequencyRadPerSec * Math.cos(turnPhase) // ψ̇
  const pitchAngleRateRadPerSec = pitchAmplitudeRad * pitchFrequencyRadPerSec * Math.cos(tSec * pitchFrequencyRadPerSec) // θ̇

  // MAVLink ATTITUDE carries BODY angular rates, not earth-frame ones. Convert
  // via the inverse Euler kinematics so the trajectory resolver's forward
  // transform (ψ̇ = (sinφ·q + cosφ·r)/cosθ, γ̇ = cosφ·q − sinφ·r) reproduces
  // exactly this heading/pitch motion. Roll rate p is not consumed downstream,
  // so it is omitted.
  const pitchSpeedRadPerSec = pitchAngleRateRadPerSec * Math.cos(rollRad) + headingRateRadPerSec * Math.cos(pitchRad) * Math.sin(rollRad)
  const yawSpeedRadPerSec = -pitchAngleRateRadPerSec * Math.sin(rollRad) + headingRateRadPerSec * Math.cos(pitchRad) * Math.cos(rollRad)

  const groundSpeedMps = 16 + Math.sin(tSec * 0.26) * 1.8
  // Still-air mock: no wind model yet, so true airspeed equals groundspeed. The
  // channels are kept distinct so the airspeed-driven stall path is exercised.
  const airSpeedMps = groundSpeedMps
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
      pitchSpeedRadPerSec,
      yawSpeedRadPerSec,
    },
    vfrHud: {
      headingDeg,
      airSpeedMps,
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

/**
 * Build a finite synthetic mission: the analytic velocity from
 * `buildMockLiveSample` cumulatively integrated into an ENU path, then inverted
 * to absolute lat/lon/alt about `MOCK_ORIGIN`. Because the LLA is the exact
 * algebraic inverse of `projectLlaToEnu` (quantized to int32 degE7 like real
 * hardware), `resolveTrack` round-trips it back to the same ENU path. This is
 * the source that drives the recorder's absolute (GPS) path.
 */
export function buildSyntheticMissionSamples(count = 40, stepMs = 180): TelemetrySample[] {
  const dtSec = stepMs / 1000
  const lat0Rad = ((MOCK_ORIGIN.latDegE7 / DEG_E7) * Math.PI) / 180
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(lat0Rad)

  let eastM = 0
  let northM = 0
  let upM = 0
  const samples: TelemetrySample[] = []

  for (let index = 0; index < count; index += 1) {
    const timestampMs = index * stepMs
    const base = buildMockLiveSample(timestampMs)
    const gp = base.globalPositionInt ?? {}

    // Advance the position by this frame's NED velocity (skip the first frame
    // so the track starts exactly at the origin). vx = North, vy = East,
    // vz = Down → up integrates as (-vz).
    if (index > 0) {
      northM += ((gp.vxCms ?? 0) / 100) * dtSec
      eastM += ((gp.vyCms ?? 0) / 100) * dtSec
      upM += (-(gp.vzCms ?? 0) / 100) * dtSec
    }

    samples.push({
      ...base,
      globalPositionInt: {
        ...gp,
        latDegE7: Math.round(MOCK_ORIGIN.latDegE7 + (northM / METERS_PER_DEG_LAT) * DEG_E7),
        lonDegE7: Math.round(MOCK_ORIGIN.lonDegE7 + (eastM / metersPerDegLon) * DEG_E7),
        altMm: Math.round(MOCK_ORIGIN.altMm + upM * 1000),
        relativeAltMm: Math.round(upM * 1000),
      },
    })
  }

  return samples
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
