# GCS Build-Out
What started out as an instrument build-out for use on an ESP32 board evolved into push towards a full suite of MAVLink/auto-pilot web-application. I'm now targetting a multi-node, TAK-style oversight and management software as a staging and validation harness for future ports or application iterations. 

**GCS Validation Harness:**
```bash
npm run dev:gcs
```

**Trajectory Projection Instrument Validation Harness:**
```bash
npm run dev:instruments
```

**Ramblings:**
Examples: 
- Most, if not all, functionality outlined below is already built better, more efficiently, with ample supported/maintained build targets for a wider range of hardware: 
  - MissionPlanner - ArduPilot configurator, also serves at GCS software
  - QGroundControl - Less-good ArduPilot configurator, a better GCS though

Portability & Evolution: 
- Architecture must be portable and rooted in documented and established MAVLink application conventions.
- Core logic must be isolated and tested, functionality should remain modular, UI should remain composable. 

Order of Operations (?):
- Build out MAVLink bridge to power basic flight instruments. Validate before porting to ESP32. These can be ported into a GCS environement as modules, and translated for ESP32 HUD/beam-splitting application. 
- Build out video bridge to integrate into GCS suite.  
- Build out mission-planning capabilities
- Build out mutli-node capabilities 
- Bench tests
- Field tests
- Chat? Video Chat? Just for funsies?

Future Considerations: 
- Consider network heuristics
- Consider persistence mechanism
- Consider Lora/Mesh integration (Meshtastic nodes for humans, redundant telemetry streams onboard drones, mesh network & signal relays etc...)
- Consider practical failure modes and how they manifest in telemetry streams. 


## 1. MAVLink Flight-Instrument Harness
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

## Features
#### Basic Telemetry
1. Attitude Indicator / Artificial Horizon — shows pitch AND roll together
   - Pitch: horizon line moves up/down
   - Roll: horizon line tilts
2. Heading Indicator / Heading Tape — yaw (nose direction, compass-referenced)
3. Rigid body orientation in 3 dimensional space (no velocity)
4. Cartesian Position Replay

#### Extrapolation
1. Predictive path — linear and turn-aware (CTRV) projection, plus an integrated
   trajectory that blends heading/track/bank/pitch with wind-drift, stall cues, and 

### Log Consumption
1. GPS/Location positional replay

## Mock GCS Dash (Mavlink Exploration)
1. Rebuild a basic GCS (QGroundControl or MissionPlanner) with READONLY capabilities. 
2. Video streaming exploration

## 2. MAVLink GCS Sandbox
Establish central observability mechanism for tracking statefulness of remote nodes:
- Local position, orientation, and trajectory in cartesian space: describing relativity of vehicle to unbounded space. 
- Contextual positioning: where is IT in relation to ME or THAT. 
- Mission-planning: managing navigation way points in real time. 
- Vehicle controls: managing vehicle state (ARM, RTH, FAISLAFE)
- Integrated video streaming: real-time, networked FPV. 
- 3D rendering: 2D maps are cool, showing real position data in 3D space would be neat (and potentially load bearing for some fun enhancements)

## 3. Cloud Hosting?






## Documentation
- [docs/architecture.md](docs/architecture.md) — data flow, module map, conventions, tooling
- [docs/heading_indicator.md](docs/heading_indicator.md) — heading source resolution
- [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md) — attitude/horizon + 3D orientation
- [docs/flight_path_marker.md](docs/flight_path_marker.md) — FPM, FPA, predictive trajectory
- [docs/mavlink_gcs_consume_plan.md](docs/mavlink_gcs_consume_plan.md) — receive-only MAVLink GCS roadmap and concrete next steps
- [docs/gcs_runtime_blueprint.md](docs/gcs_runtime_blueprint.md) — portable runtime architecture for cloud-web and Pi-local deployment
- [docs/decisions.md](docs/decisions.md) — Architecture Decision Record (ADR) log
- [CHANGELOG.md](CHANGELOG.md) — notable changes over time
