# GCS Build-Out
What started out as an instrument build-out for use on an ESP32 board evolved into a ground control station (GCS) reproduction. 

# HUD Visualizer
**Setup & Problem Statement**
Original: I'm running a Hawkeye Firefly 4k Split camera which supports analog video streaming & onboard 4k recording. The camera is fixed to a pan/tilt gimbal. Loss of orientation to the craft and the ground is shockingly easy (and historically catastrophic). As POV rotates with the gimbal, having a fixed-reference with additional telemetry seems useful. Furthermore I use video quite a bit for debugging so having non-telemetry frame of reference can be helpful in log-analysis and debugging. 

Current: This has somewhat evolved into a quasi ground-control-station/MAVLink application.

**Solution Statement**
Yeah this can be solved with a piece of tape. I'd rather over-engineer a solution. 

Current material goal: Use beam-splitter glass to print custom HUD instrument from an ESP32-S3 + 2inch screen. 
Supporting goals: 
- MAVLink dash - begin understanding MAVLink protocol & sytstem/application building
- Mission-simulation - fake-log generator
- Mission-replay - view instrumentation via simulated logs


**Repo Purpose**
1. Flesh out what features I actually want.
2. Establish core functions and algorithm for extrapolating cardinality in Euclidean space. 
3. Prepare for translation into C++ or lua (or whatever). 


## What this repo actually is
A **monorepo** for HUD validation and rendering experiments, not the flight HUD itself.
The browser validation harness lives here in `apps/hud`; the separate native experiment
lives in [apps/desktop](../desktop). All browser HUD math lives in
pure, framework-free resolvers under [src/logic/](src/logic/) so it can be
proven against known-answer replay frames and later ported to C++/ESP32 firmware. The hud app
renders both a live mock feed and expected-vs-resolved validation tables.

The future device application starts in [apps/esp32](../esp32). Its C++ core can be run on
your local machine before it is flashed to a board: `pnpm test:esp32` runs host tests and
`pnpm preview:esp32` writes a deterministic SVG preview.

## Features
#### Basic Telemetry
1. Attitude Indicator / Artificial Horizon — shows pitch AND roll together
   - Pitch: horizon line moves up/down
   - Roll: horizon line tilts
2. Heading Indicator / Heading Tape — yaw (nose direction, compass-referenced)
3. Rigid body orientation in 3 dimensional space (no velocity)

#### Extrapolation
1. Predictive path — linear and turn-aware (CTRV) projection, plus an integrated
   trajectory that blends heading/track/bank/pitch with wind-drift, stall cues, and 

### Log Consumption
1. GPS/Location positional replay
2. PID replay/tuning


## Mock GCS Dash (Mavlink Exploration)
1. Rebuild a basic GCS (QGroundControl or MissionPlanner) with READONLY capabilities. 
2. Video streaming exploration

## Running this app
From this directory:

```bash
pnpm install
pnpm dev
npm test
pnpm build
```

From the repository root, use `pnpm dev:hud`, `pnpm test:hud`, and the matching
`build:hud` / `lint:hud` commands.

## Documentation
- [docs/architecture.md](../../docs/architecture.md) — data flow, module map, conventions, tooling
- [docs/heading_indicator.md](../../docs/heading_indicator.md) — heading source resolution
- [docs/attitude_and_horizon_indicator.md](../../docs/attitude_and_horizon_indicator.md) — attitude/horizon + 3D orientation
- [docs/flight_path_marker.md](../../docs/flight_path_marker.md) — FPM, FPA, predictive trajectory
- [docs/ardupilot_sitl_testing.md](../../docs/ardupilot_sitl_testing.md) — current mixed-vehicle validation workflows
- [docs/gcs_runtime_blueprint.md](../../docs/gcs_runtime_blueprint.md) — portable runtime architecture for cloud-web and Pi-local deployment
- [docs/decisions.md](../../docs/decisions.md) — Architecture Decision Record (ADR) log
- [CHANGELOG.md](../../CHANGELOG.md) — notable changes over time
