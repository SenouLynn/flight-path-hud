# GCS Build-Out
What started out as an instrument build-out for use on an ESP32 board evolved into push towards a full suite of MAVLink/auto-pilot web-application. I'm now targetting a multi-node, TAK-style command+control as a staging and validation harness for future ports or application iterations. 

**GCS Validation Harness:**
```bash
pnpm gcs:mock
```

**Trajectory Projection Instrument Validation Harness:**
```bash
pnpm dev:hud
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
- SITL (Software in the Loop) harness validation
- Vehicle controls: managing vehicle state (ARM, RTH, FAISLAFE)
- Integrated video streaming: real-time, networked FPV. 
- 3D rendering: 2D maps are cool, showing real position data in 3D space would be neat (and potentially load bearing for some fun enhancements)


## Current validation workflows

Install dependencies once:

```bash
corepack enable
pnpm install --frozen-lockfile
```

The repository pins pnpm in `package.json` and uses one root `pnpm-lock.yaml`.
Dependency resolution enforces a strict seven-day release quarantine for direct
and transitive packages. Resolution also fails when registry publish-time
metadata is missing. Any exception must name an exact package/version in
`pnpm-workspace.yaml` and document why bypassing the quarantine is necessary.

### GCS mock mode

The deterministic development harness starts the browser GCS, MAVLink bridge,
synthetic two-vehicle fleet, and mock video source:

```bash
pnpm gcs:mock
```

### GCS mixed-SITL mode

The real-producer harness starts Docker Compose in the background with pinned
ArduPilot 4.6.2 + ArduCopter (`1:1`), ArduPlane (`2:1`), and the bridge, and runs
the browser GCS. Open the Vite address it prints (normally
`http://localhost:5174`) and use `ws://localhost:8080/telemetry`.

```bash
pnpm gcs:sitl-test
```

Stop the detached simulator stack after the GCS exits:

```bash
pnpm sitl-test:down
```

For attached Compose output or diagnostics, use `pnpm sitl-test:up` or
`pnpm sitl-test:logs`. The first SITL build compiles ArduPilot and is intentionally
large; Docker caches the result locally. Docker Desktop Linux/arm64 containers
are the supported path on Apple Silicon Macs. Native macOS SITL is best-effort.

The GCS remains receive-only for field-connected systems. State-changing command
surfaces are dual-gated and available only in explicit isolated-SITL validation
workflows; loading a mission never arms a vehicle or starts AUTO mode.

### Checks and maintenance

```bash
pnpm build:gcs
pnpm test:gcs-core
pnpm test:bridge
pnpm clean:recordings -- --dry-run
```

## Documentation
- [docs/architecture.md](docs/architecture.md) — data flow, module map, conventions, tooling
- [docs/heading_indicator.md](docs/heading_indicator.md) — heading source resolution
- [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md) — attitude/horizon + 3D orientation
- [docs/flight_path_marker.md](docs/flight_path_marker.md) — FPM, FPA, predictive trajectory
- [docs/gcs_runtime_blueprint.md](docs/gcs_runtime_blueprint.md) — portable runtime architecture with Raspberry Pi 5 Linux/arm64 as a definitive local target
- [docs/mavlink_command_validation.md](docs/mavlink_command_validation.md) — staged browser-GCS command validation roadmap
- [docs/pid_tuning_workflow.md](docs/pid_tuning_workflow.md) — phased linked tuning plan, in-flight authority model, safety invariants, and evidence gates
- [docs/vehicle_configuration_roadmap.md](docs/vehicle_configuration_roadmap.md) — next-step read-first vehicle configuration plan, portable contracts, SITL/UI gates, and Go/transport migration seam
- [docs/ardupilot_sitl_testing.md](docs/ardupilot_sitl_testing.md) — mixed Copter/Plane SITL runbook and acceptance nuances
- [contracts/README.md](contracts/README.md) — portable schemas, behavioral vectors, golden MAVLink bytes, and conformance roadmap
- [docs/gcs_architecture_precedents.md](docs/gcs_architecture_precedents.md) — lessons adopted from QGroundControl and Mission Planner
- [docs/terrain_and_3d_map_notes.md](docs/terrain_and_3d_map_notes.md) — ArduPilot terrain files versus future browser 3D-map terrain
- [docs/decisions.md](docs/decisions.md) — Architecture Decision Record (ADR) log
- [CHANGELOG.md](CHANGELOG.md) — notable changes over time
