# Architecture & Project Structure

This repo is a **validation harness** for the HUD logic that will eventually run on an
ESP32-driven reflex-sight display. The React app is not the flight HUD — it is a
deterministic testbench that lets us prove out the math (heading resolution, attitude,
flight-path extrapolation) against known-answer frames before porting to C++/firmware.

See the [README](../README.md) for the physical setup and motivation.

## Data flow

```
MAVLink (real, later)                 ┌──────────────────────────────────────────┐
        │                             │  logic/ (pure, framework-free resolvers)  │
        ▼                             │                                            │
┌───────────────────┐   TelemetrySample   ┌───────────────┐                       │
│ stream/            │ ─────────────────▶ │ telemetry.ts  │  sanitize (drop NaN)  │
│  telemetrySource   │                    └──────┬────────┘                       │
│  (synthetic /      │                           ▼                                │
│   live-mock)       │            ┌──────────────┴───────────────┐                │
└───────────────────┘            │ heading / attitude /          │  resolution    │
        │                        │ flightPath / trajectory       │  objects       │
        ▼                        └──────────────┬───────────────┘  (+ `source`)   │
┌───────────────────┐                           │                                 │
│ useTelemetryFeed   │                           ▼                                 │
│  (React hook)      │            ┌──────────────────────────────┐                │
└───────────────────┘            │ components/ (SVG rendering)   │                │
        │                        │  PFD, Orientation, Trajectory │                │
        └───────────▶ App.tsx ──▶└──────────────────────────────┘                │
                          │                                                        │
                          └──▶ replay.ts (known-answer frames) ── validation tables│
                                                                └───────────────────┘
```

Two things drive the UI simultaneously:

1. **Live feed** — a `TelemetrySource` emits `TelemetrySample`s on a timer; the
   `useTelemetryFeed` hook stores the latest one; resolvers turn it into display values;
   components render it.
2. **Replay validation** — `replay.ts` holds hand-computed *expected* values for a set of
   synthetic frames. `App.tsx` runs each resolver over those frames and renders
   expected-vs-resolved-vs-error tables. This is the "is the math right?" surface.

## Design conventions

- **Resolvers are pure functions.** Every file in [src/logic/](../src/logic/) exports
  `resolveX(sample) → { ...values, source }`. No React, no I/O, no globals. This is what
  makes them portable to C++ and trivially unit-testable.
- **Provenance via `source`.** Each resolution reports which MAVLink field it actually
  used (e.g. `speedSource: 'VFR_HUD.groundspeed' | 'GLOBAL_POSITION_INT.vx_vy' | ...`).
  This lets us see data lineage and decide which fields the firmware must guarantee.
- **Sanitize at the boundary.** `sanitizeTelemetrySample` (in
  [telemetry.ts](../src/logic/telemetry.ts)) strips `NaN`/`Infinity`/non-numbers to
  `undefined` before any resolver runs, so downstream code only ever branches on
  "present and finite" vs "absent".
- **Fallback chains, not hard requirements.** Where multiple MAVLink messages can supply
  the same quantity, resolvers try them in a documented priority order and record which
  one won.

## Directory map

| Path | Responsibility |
|------|----------------|
| [src/logic/telemetry.ts](../src/logic/telemetry.ts) | `TelemetrySample` type + `sanitizeTelemetrySample` boundary guard |
| [src/logic/heading.ts](../src/logic/heading.ts) | Heading source resolution + normalization |
| [src/logic/attitude.ts](../src/logic/attitude.ts) | Pitch/roll → horizon line transform |
| [src/logic/flightPath.ts](../src/logic/flightPath.ts) | Ground speed/climb, 2D track, 3D FPA, predictive path |
| [src/logic/trajectory.ts](../src/logic/trajectory.ts) | Integrated predictive trajectory (blends heading/track/bank/pitch) |
| [src/logic/replay.ts](../src/logic/replay.ts) | Known-answer validation frames + replay runners |
| [src/constants/mavlinkInputs.ts](../src/constants/mavlinkInputs.ts) | Canonical MAVLink field registry (message/field/units/type) |
| [src/stream/telemetrySource.ts](../src/stream/telemetrySource.ts) | Synthetic-replay and live-mock sample generators |
| [src/stream/useTelemetryFeed.ts](../src/stream/useTelemetryFeed.ts) | React hook subscribing to a `TelemetrySource` |
| [src/components/](../src/components/) | SVG HUD instruments (see below) |
| [src/App.tsx](../src/App.tsx) | Wires feed + replay tables + instrument previews |

### Components

| Component | Renders |
|-----------|---------|
| [HudPrimaryFlightDisplay](../src/components/HudPrimaryFlightDisplay.tsx) | Composes heading tape over attitude indicator |
| [HudHeadingIndicator](../src/components/HudHeadingIndicator.tsx) | Scrolling compass tape (yaw) |
| [HudAttitudeIndicator](../src/components/HudAttitudeIndicator.tsx) | Artificial horizon + pitch ladder + roll arc |
| [HudOrientationIndicator](../src/components/HudOrientationIndicator.tsx) | 3D wireframe vehicle model (roll/pitch/yaw) |
| [HudPredictiveTrajectory](../src/components/HudPredictiveTrajectory.tsx) | Integrated forward path with drift/stall cues |

## Validation harness (`replay.ts`)

Each feature has a frame set with hand-derived expected values:

- `HEADING_VALIDATION_FRAMES` — primary/fallback source selection + wrap + unknown sentinel.
- `ATTITUDE_VALIDATION_FRAMES` — pitch offset in px, roll degrees, missing-field handling.
- `FLIGHT_PATH_VALIDATION_FRAMES` — track, speed, climb, FPA, and 5 s linear vs turn-aware
  path endpoints.

`runHeadingReplay` / `runAttitudeReplay` / `runFlightPathReplay` execute the real
resolvers over these frames and compute absolute errors, which `App.tsx` renders as
tables. Errors should read as `0.000000` (or `N/A` where a value is intentionally absent).
The Vitest suites in `*.test.ts` assert the same properties programmatically.

## Tooling

- **Build:** Vite 8 + React 19 + TypeScript 6. `npm run build` = `tsc -b && vite build`.
- **Dev server:** `npm run dev`.
- **Tests:** Vitest 4. `npm test` (run once) / `npm run test:watch`.
- **Lint:** `npm run lint` (flat-config ESLint + typescript-eslint).

## Known issues / conventions to watch

- **Two attitude implementations exist and can disagree on sign.**
  [attitude.ts](../src/logic/attitude.ts) drives the replay-preview horizon using a
  `pitchPositiveMovesDown` flag and a `rotatePoint` on the line endpoints.
  [HudAttitudeIndicator.tsx](../src/components/HudAttitudeIndicator.tsx) re-implements the
  transform independently (`roll = -rollDeg`, `translate(0, pitchOffset)`). Because the
  sign conventions are defined in two places, the live HUD and the preview can invert
  relative to each other — this is the "rendering is inverted in some places" note from
  commit `355baff`. Unifying on one transform is the natural next cleanup.
- **NED sign flips.** Velocity `vz` is **positive-down** in MAVLink; climb rate is
  **positive-up**. Resolvers negate (`-vz`) — see [flightPath.ts](../src/logic/flightPath.ts).
