# HUD Visualizer
**Setup & Problem Statement**
I'm running a Hawkeye Firefly 4k Split camera which supports analog video streaming & onboard 4k recording. The camera is fixed to a pan/tilt gimbal. Loss of orientation to the craft and the ground is shockingly easy (and historically catastrophic). As POV rotates with the gimbal, having a fixed-reference with additional telemetry seems useful. Furthermore I use video quite a bit for debugging so having non-telemetry frame of reference can be helpful in log-analysis and debugging. 

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
The browser validation harness lives in [apps/web](apps/web); the separate native experiment
lives in [apps/desktop](apps/desktop). All browser HUD math lives in
pure, framework-free resolvers under [apps/web/src/logic/](apps/web/src/logic/) so it can be
proven against known-answer replay frames and later ported to C++/ESP32 firmware. The web app
renders both a live mock feed and expected-vs-resolved validation tables.

The future device application starts in [apps/esp32](apps/esp32). Its C++ core can be run on
your local machine before it is flashed to a board: `npm run test:esp32` runs host tests and
`npm run preview:esp32` writes a deterministic SVG preview.

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

## General Knowledge 
1. Basic physics engine - run mock simulations? 

## Mock GCS Dash (Mavlink Exploration)
1. Rebuild a basic GCS (QGroundControl or MissionPlanner) with READONLY capabilities. 
