import { resolveHeading, type HeadingResolution } from './heading'
import { computeHorizonTransform, type HorizonTransform } from './attitude'
import {
  resolveFlightPath2d,
  resolveFlightPath3d,
  resolvePredictivePath,
  resolveScalarTelemetry,
  type FlightPath2dResolution,
  type FlightPath3dResolution,
  type PredictivePathResolution,
  type ScalarTelemetryResolution,
} from './flightPath'
import type { TelemetrySample } from './telemetry'

export interface ReplayFrame {
  id: string
  sample: TelemetrySample
  expectedHeadingDeg: number | null
}

export interface HeadingReplayResult {
  id: string
  expectedHeadingDeg: number | null
  result: HeadingResolution
  absoluteErrorDeg: number | null
}

export interface AttitudeReplayFrame {
  id: string
  sample: TelemetrySample
  expectedPitchDeg: number | null
  expectedRollDeg: number | null
  expectedPitchOffsetPx: number | null
}

export interface AttitudeReplayResult {
  id: string
  expectedPitchDeg: number | null
  expectedRollDeg: number | null
  expectedPitchOffsetPx: number | null
  transform: HorizonTransform | null
  pitchErrorDeg: number | null
  rollErrorDeg: number | null
  pitchOffsetErrorPx: number | null
}

export interface FlightPathReplayFrame {
  id: string
  sample: TelemetrySample
  expectedTrackDeg: number | null
  expectedSpeedMps: number | null
  expectedClimbMps: number | null
  expectedFpaDeg: number | null
  expectedLinearEndNorthM: number | null
  expectedLinearEndEastM: number | null
  expectedTurnEndNorthM: number | null
  expectedTurnEndEastM: number | null
}

export interface FlightPathReplayResult {
  id: string
  expectedTrackDeg: number | null
  expectedSpeedMps: number | null
  expectedClimbMps: number | null
  expectedFpaDeg: number | null
  expectedLinearEndNorthM: number | null
  expectedLinearEndEastM: number | null
  expectedTurnEndNorthM: number | null
  expectedTurnEndEastM: number | null
  scalar: ScalarTelemetryResolution
  vector2d: FlightPath2dResolution
  vector3d: FlightPath3dResolution
  predictive: PredictivePathResolution
  trackErrorDeg: number | null
  speedErrorMps: number | null
  climbErrorMps: number | null
  fpaErrorDeg: number | null
  linearEndErrorM: number | null
  turnEndErrorM: number | null
}

export const HEADING_VALIDATION_FRAMES: ReplayFrame[] = [
  {
    id: 'vfr-primary-090',
    sample: {
      timestampMs: 0,
      vfrHud: { headingDeg: 90 },
    },
    expectedHeadingDeg: 90,
  },
  {
    id: 'vfr-wrap-370',
    sample: {
      timestampMs: 100,
      vfrHud: { headingDeg: 370 },
    },
    expectedHeadingDeg: 10,
  },
  {
    id: 'attitude-fallback-neg-quarter-turn',
    sample: {
      timestampMs: 200,
      attitude: { yawRad: -Math.PI / 2 },
    },
    expectedHeadingDeg: 270,
  },
  {
    id: 'global-fallback-centideg',
    sample: {
      timestampMs: 300,
      globalPositionInt: { headingCdeg: 12345 },
    },
    expectedHeadingDeg: 123.45,
  },
  {
    id: 'global-unknown-no-heading',
    sample: {
      timestampMs: 400,
      globalPositionInt: { headingCdeg: 65535 },
    },
    expectedHeadingDeg: null,
  },
]

export const ATTITUDE_VALIDATION_FRAMES: AttitudeReplayFrame[] = [
  {
    id: 'attitude-level-flight',
    sample: {
      timestampMs: 0,
      attitude: {
        pitchRad: 0,
        rollRad: 0,
      },
    },
    expectedPitchDeg: 0,
    expectedRollDeg: 0,
    expectedPitchOffsetPx: 0,
  },
  {
    id: 'attitude-pitch-up-10deg',
    sample: {
      timestampMs: 100,
      attitude: {
        pitchRad: Math.PI / 18,
        rollRad: 0,
      },
    },
    expectedPitchDeg: 10,
    expectedRollDeg: 0,
    expectedPitchOffsetPx: 60,
  },
  {
    id: 'attitude-roll-right-30deg',
    sample: {
      timestampMs: 200,
      attitude: {
        pitchRad: 0,
        rollRad: Math.PI / 6,
      },
    },
    expectedPitchDeg: 0,
    expectedRollDeg: 30,
    expectedPitchOffsetPx: 0,
  },
  {
    id: 'attitude-combined-pitch-down-roll-left',
    sample: {
      timestampMs: 300,
      attitude: {
        pitchRad: -Math.PI / 36,
        rollRad: -Math.PI / 4,
      },
    },
    expectedPitchDeg: -5,
    expectedRollDeg: -45,
    expectedPitchOffsetPx: -30,
  },
  {
    id: 'attitude-missing-values',
    sample: {
      timestampMs: 400,
      attitude: {
        pitchRad: Math.PI / 18,
      },
    },
    expectedPitchDeg: null,
    expectedRollDeg: null,
    expectedPitchOffsetPx: null,
  },
]

export const FLIGHT_PATH_VALIDATION_FRAMES: FlightPathReplayFrame[] = [
  {
    id: 'fpm-vfr-primary-scalars',
    sample: {
      timestampMs: 0,
      vfrHud: {
        groundSpeedMps: 20,
        climbMps: 2.5,
      },
      globalPositionInt: {
        vxCms: 1200,
        vyCms: 1600,
        vzCms: -250,
      },
    },
    expectedTrackDeg: 53.130102,
    expectedSpeedMps: 20,
    expectedClimbMps: 2.5,
    expectedFpaDeg: 7.125016,
    expectedLinearEndNorthM: 60,
    expectedLinearEndEastM: 80,
    expectedTurnEndNorthM: 60,
    expectedTurnEndEastM: 80,
  },
  {
    id: 'fpm-global-fallback-scalars-and-track',
    sample: {
      timestampMs: 100,
      globalPositionInt: {
        vxCms: 1000,
        vyCms: 0,
        vzCms: 120,
      },
      attitude: {
        yawSpeedRadPerSec: 0.2,
      },
    },
    expectedTrackDeg: 0,
    expectedSpeedMps: 10,
    expectedClimbMps: -1.2,
    expectedFpaDeg: -6.842773,
    expectedLinearEndNorthM: 50,
    expectedLinearEndEastM: 0,
    expectedTurnEndNorthM: 42.073549,
    expectedTurnEndEastM: 22.984885,
  },
  {
    id: 'fpm-gps-fallback-track',
    sample: {
      timestampMs: 200,
      gpsRawInt: {
        cogCdeg: 27000,
        velCms: 1550,
      },
    },
    expectedTrackDeg: 270,
    expectedSpeedMps: 15.5,
    expectedClimbMps: null,
    expectedFpaDeg: null,
    expectedLinearEndNorthM: null,
    expectedLinearEndEastM: null,
    expectedTurnEndNorthM: null,
    expectedTurnEndEastM: null,
  },
  {
    id: 'fpm-stationary-invalid-track',
    sample: {
      timestampMs: 300,
      globalPositionInt: {
        vxCms: 0,
        vyCms: 0,
        vzCms: 0,
      },
    },
    expectedTrackDeg: null,
    expectedSpeedMps: 0,
    expectedClimbMps: 0,
    expectedFpaDeg: null,
    expectedLinearEndNorthM: null,
    expectedLinearEndEastM: null,
    expectedTurnEndNorthM: null,
    expectedTurnEndEastM: null,
  },
]

export function runHeadingReplay(frames: ReplayFrame[]): HeadingReplayResult[] {
  return frames.map((frame) => {
    const result = resolveHeading(frame.sample)

    const absoluteErrorDeg
      = frame.expectedHeadingDeg === null || result.headingDeg === null
        ? null
        : Math.abs(result.headingDeg - frame.expectedHeadingDeg)

    return {
      id: frame.id,
      expectedHeadingDeg: frame.expectedHeadingDeg,
      result,
      absoluteErrorDeg,
    }
  })
}

export function runAttitudeReplay(frames: AttitudeReplayFrame[]): AttitudeReplayResult[] {
  return frames.map((frame) => {
    const transform = computeHorizonTransform(frame.sample)

    const pitchErrorDeg
      = frame.expectedPitchDeg === null || transform === null
        ? null
        : Math.abs(transform.pitchDeg - frame.expectedPitchDeg)

    const rollErrorDeg
      = frame.expectedRollDeg === null || transform === null
        ? null
        : Math.abs(transform.rollDeg - frame.expectedRollDeg)

    const pitchOffsetErrorPx
      = frame.expectedPitchOffsetPx === null || transform === null
        ? null
        : Math.abs(transform.pitchOffsetPx - frame.expectedPitchOffsetPx)

    return {
      id: frame.id,
      expectedPitchDeg: frame.expectedPitchDeg,
      expectedRollDeg: frame.expectedRollDeg,
      expectedPitchOffsetPx: frame.expectedPitchOffsetPx,
      transform,
      pitchErrorDeg,
      rollErrorDeg,
      pitchOffsetErrorPx,
    }
  })
}

export function runFlightPathReplay(frames: FlightPathReplayFrame[]): FlightPathReplayResult[] {
  return frames.map((frame) => {
    const scalar = resolveScalarTelemetry(frame.sample)
    const vector2d = resolveFlightPath2d(frame.sample)
    const vector3d = resolveFlightPath3d(frame.sample)
    const predictive = resolvePredictivePath(frame.sample)

    const trackErrorDeg
      = frame.expectedTrackDeg === null || vector2d.trackDeg === null
        ? null
        : Math.abs(vector2d.trackDeg - frame.expectedTrackDeg)

    const speedErrorMps
      = frame.expectedSpeedMps === null || scalar.groundSpeedMps === null
        ? null
        : Math.abs(scalar.groundSpeedMps - frame.expectedSpeedMps)

    const climbErrorMps
      = frame.expectedClimbMps === null || scalar.climbMps === null
        ? null
        : Math.abs(scalar.climbMps - frame.expectedClimbMps)

    const fpaErrorDeg
      = frame.expectedFpaDeg === null || vector3d.flightPathAngleDeg === null
        ? null
        : Math.abs(vector3d.flightPathAngleDeg - frame.expectedFpaDeg)

    const linearEnd = predictive.linear.at(-1)
    const turnEnd = predictive.turnAware.at(-1)

    const linearEndErrorM
      = frame.expectedLinearEndNorthM === null
        || frame.expectedLinearEndEastM === null
        || linearEnd === undefined
        ? null
        : Math.hypot(
          linearEnd.northM - frame.expectedLinearEndNorthM,
          linearEnd.eastM - frame.expectedLinearEndEastM,
        )

    const turnEndErrorM
      = frame.expectedTurnEndNorthM === null
        || frame.expectedTurnEndEastM === null
        || turnEnd === undefined
        ? null
        : Math.hypot(
          turnEnd.northM - frame.expectedTurnEndNorthM,
          turnEnd.eastM - frame.expectedTurnEndEastM,
        )

    return {
      id: frame.id,
      expectedTrackDeg: frame.expectedTrackDeg,
      expectedSpeedMps: frame.expectedSpeedMps,
      expectedClimbMps: frame.expectedClimbMps,
      expectedFpaDeg: frame.expectedFpaDeg,
      expectedLinearEndNorthM: frame.expectedLinearEndNorthM,
      expectedLinearEndEastM: frame.expectedLinearEndEastM,
      expectedTurnEndNorthM: frame.expectedTurnEndNorthM,
      expectedTurnEndEastM: frame.expectedTurnEndEastM,
      scalar,
      vector2d,
      vector3d,
      predictive,
      trackErrorDeg,
      speedErrorMps,
      climbErrorMps,
      fpaErrorDeg,
      linearEndErrorM,
      turnEndErrorM,
    }
  })
}
