# HUD Visualizer
**Setup & Problem Statement**
I'm running a Hawkeye Firefly 4k Split camera which supports analog video streaming & onboard 4k recording. The camera is fixed to a pan/tilt gimbal. Loss of orientation to the craft and the ground is shockingly easy (and historically catastrophic). Also I use video quite a bit for debugging so having non-telemetry frame of reference can be helpful in log-analysis and debugging. As POV rotates with the gimbal, having a fixed-reference with additional telemetry seems useful.

**Solution Statement**
Yeah this can be solved with a piece of tape. I'd rather over-engineer a solution. 

I want to build a reflex sight/holo sight on which I project a predictive trajectory HUD from an ESP32 board and 1.2in OLED screen. 

**Repo Purpose**
1. Flesh out what features I actually want.
2. Establish core functions and algorithm for extrapolating cardinality in Euclidean space. 
3. Prepare for translation into C++ or lua (or whatever). 


## What this repo actually is
A **monorepo** for HUD validation and rendering experiments, not the flight HUD itself.
The browser validation harness lives in [apps/web](apps/web); the separate native experiment
lives in [apps/desktop](apps/desktop). All browser HUD math lives in
pure, framework-free resolvers under [apps/web/src/logic/](apps/web/src/logic/) so it can be
proven against known-answer replay frames and later ported to C++/ESP32 firmware. The web app
renders both a live mock feed and expected-vs-resolved validation tables.

## Features
#### Basic Telemetry
1. Attitude Indicator / Artificial Horizon — shows pitch AND roll together
   - Pitch: horizon line moves up/down
   - Roll: horizon line tilts
2. Heading Indicator / Heading Tape — shows yaw (nose direction, compass-referenced)
3. Rigid body orientation in 3 dimensional space (no velocity)

#### Extrapolation
1. Predictive path — linear and turn-aware (CTRV) projection, plus an integrated
   trajectory that blends heading/track/bank/pitch with wind-drift, stall cues, and 

### Log Consumption
1. GPS/Location positional replay
2. PID replay/tuning

## General Knowledge 
1. Basic physics engine - run mock simulations



## Getting started
```bash
npm install
npm run dev:web      # Vite dev server
npm run test:web     # Vitest known-answer suites
npm run build:web    # tsc -b && vite build
npm run lint:web
```

The native Dear ImGui experiment has an intentionally independent toolchain. Bootstrap it
once with `npm run bootstrap:desktop`, then see its [README](apps/desktop/README.md).

## Documentation
- [docs/architecture.md](docs/architecture.md) — data flow, module map, conventions, tooling
- [docs/heading_indicator.md](docs/heading_indicator.md) — heading source resolution
- [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md) — attitude/horizon + 3D orientation
- [docs/flight_path_marker.md](docs/flight_path_marker.md) — FPM, FPA, predictive trajectory
- [docs/decisions.md](docs/decisions.md) — Architecture Decision Record (ADR) log
- [CHANGELOG.md](CHANGELOG.md) — notable changes over time

> **For AI agents & contributors:** `docs/decisions.md` and `CHANGELOG.md` are living
> documents. When you make a decision that shapes the architecture, add an ADR entry;
> when you ship a notable change, add a changelog entry. See each file's header for the
> format.
