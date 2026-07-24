# HUD Visualizer
**Setup & Problem Statement**
For my FPV setup, I'm running a Hawkeye Firefly 4k Split camera which supports analog video streaming AND onboard 4k recording. Furthermore the camera is fixed to a pan/tilt gimbal in the general area of a 'cockpit'. The presenting issue with gimbal'd FPV is loss of orientation in relation to the aircraft and the aircrafts orientation to the ground. Secondarily, I use video quite a bit in my debugging process as I focus 90% of my focus on piloting. Building an ingestion harness is a nice side-effect. Maybe a custom blackbox/log analyzer/replayer would be cool.

**Solution Statement**
Naively this could be solved with tape or 3d printing a static item and glue to the body. That's no fun though. 
The goal is to make a dashboard HUD projected onto a reflex sight, hard-mounted to the airframe as a visual point of reference. This can be achieved by consuming MAVLINK on an ESP32 board and projecting graphics onto a 1inch screen onto an angled piece of glass. 

**Repo Purpose**
1. Flesh out what features I actually want.
2. Establish algorithm for extrapolating cardinality in 3 dimensions. 
3. Prepare for translation into C++ or lua (or whatever). 


## What this repo actually is
A **validation harness** (React + TypeScript + Vite), not the flight HUD itself. All HUD
math lives in pure, framework-free resolvers under [src/logic/](src/logic/) so it can be
proven against known-answer replay frames and later ported to C++/ESP32 firmware. The app
renders both a live mock feed and expected-vs-resolved validation tables.

## Features
#### Basic Telemetry
1. Attitude Indicator / Artificial Horizon — shows pitch AND roll together
   - Pitch: horizon line moves up/down
   - Roll: horizon line tilts
2. Heading Indicator / Heading Tape — shows yaw (nose direction, compass-referenced)
3. Basic orientation

#### Extrapolation
1. Flight Path Marker (velocity vector) — 2D ground track + flight path angle
2. Predictive path — linear and turn-aware (CTRV) projection, plus an integrated
   trajectory that blends heading/track/bank/pitch with wind-drift and stall cues

### Log Consumption
1. GPS/Location positional replay

## Getting started
```bash
npm install
npm run dev      # Vite dev server
npm test         # Vitest known-answer suites
npm run build    # tsc -b && vite build
npm run lint
```

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