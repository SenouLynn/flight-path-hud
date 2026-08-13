# Changelog

- Added a disabled-by-default, allowlisted `PARAM_SET` transaction and mixed-SITL
  acceptance workflow with independent read-back, target-isolation checks, and
  unconditional restoration.

- Added mixed-ArduPilot SITL acceptance for target-scoped message intervals,
  including cadence statistics, cross-target isolation, and unconditional default
  restoration.

- Migrated the JavaScript/TypeScript monorepo from npm to a single pnpm 11
  workspace and lockfile, with a strict seven-day dependency release quarantine
  and no initial exceptions.

- Added disabled-by-default, target-scoped MAVLink message-interval configuration
  with bandwidth limits, ACK correlation, and observed-message verification.

- Added target-scoped one-shot `HOME_POSITION` and `GPS_GLOBAL_ORIGIN` requests,
  correlated against both `COMMAND_ACK` and the expected response message.

- Added target-routed, read-only MAVLink parameter lookup by name or index, with
  portable transaction logic, response correlation, retry/timeout handling, and
  deterministic lifecycle recording/replay.
- Added bounded full parameter-list retrieval with out-of-order folding,
  duplicate suppression, progress reporting, and exact-target isolation.

- Added the Stage 0 MAVLink command foundation: confirmed target-explicit envelopes,
  an empty-by-default allowlist, exact-route send/retry handling, `COMMAND_ACK`
  correlation, normalized timeouts/results, and deterministic lifecycle recording/replay.

All notable changes to this project are recorded here. This is a **living document**
maintained by humans and AI agents.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Because
this repo is a validation harness rather than a released product, versioning is loose:
group work under dated headings (and a `[Unreleased]` section for in-flight work) until a
tagged release exists.

## How to update (agents: read this)

- Add notable changes under `[Unreleased]` using the standard groups: **Added**,
  **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.
- One bullet per change, phrased for a human skimming history. Link code with
  repo-relative paths where it helps.
- If a change reflects an architectural decision, add an ADR in
  [docs/decisions.md](docs/decisions.md) and reference it (e.g. `(ADR-0006)`).
- Keep entries factual — what changed and why it matters, not a commit dump.

---

## [Unreleased]

### Changed
- **Mixed-SITL motion is now a repeatable regression gate.** The test-only
  controller flies independently targeted Copter and Plane missions, preserves a
  45-second browser observation window after automated acceptance, and supplies
  a minimized real-MAVLink fixture proving per-system motion, instruments,
  mission progress, passive overlays, trail inputs, and deterministic replay.
- **Root commands now expose the two GCS validation modes directly.**
  `npm run gcs:mock` starts the deterministic local fleet, while
  `npm run gcs:sitl-test` starts the detached mixed ArduPilot Compose stack and the
  browser GCS. Obsolete bridge/sample/video composition aliases were removed
  from the root interface; SITL lifecycle commands remain for diagnostics.
- **Mixed SITL has passed its initial live smoke run.** The Docker-built Copter
  and Plane streams now reach the browser GCS together with independent map
  placement and mission pulls; retained capture/replay and single-vehicle
  restart checks remain the formal acceptance gate.
- **Mixed SITL missions now match the explicit CMAC start location.** Copter and
  Plane launch near Canberra, Australia and seed distinct local routes, replacing
  the stale Swiss-coordinate waypoint fixtures that produced disconnected map
  overlays.
- **Bridge recording retention is now 128 MB by default.** The startup sweep
  keeps the newest captures within that lower total budget; set
  `MAVLINK_BRIDGE_RECORD_TOTAL_MAX_MB` to override it for a deliberate longer
  capture window.
- **SITL image installs its pinned MAVProxy forwarding executable.** ArduPilot's
  prerequisite script sets up MAVProxy dependencies but does not provide
  `mavproxy.py`; the image now installs MAVProxy `1.8.74` before the Copter and
  Plane containers invoke `sim_vehicle.py`, and exposes its virtualenv on the
  runtime `PATH`.

### Fixed
- **Coordinate-less mission actions no longer draw routes through `0,0`.** SITL
  takeoff-at-current-position and return-to-launch commands remain visible under
  their true mission sequence numbers, but the map omits their protocol sentinel
  coordinates instead of placing false waypoints off Africa.
- **Breadcrumb trails ignore startup GPS discontinuities.** The GCS now advances
  a trail only for `GLOBAL_POSITION_INT` frames and begins a fresh trail after a
  jump greater than 1 km, rather than connecting a simulator's placeholder fix
  to its initialized location with a phantom long-distance route.
- **SITL's Linux bridge install no longer overwrites macOS GCS dependencies.**
  The Compose bridge now keeps its `node_modules` in a Docker volume, preserving
  the host's Darwin Rolldown/Vite native binding for `npm run dev:gcs`.
- **Headless SITL waits for GPS/home initialization before seeding missions.** A
  heartbeat establishes the autopilot connection but can precede `HOME_POSITION`,
  which made Copter initially report mission item zero at `0,0`. The SITL-only
  MAVLink handshake now waits for both, then MAVProxy runs non-interactively as
  the persistent forwarding hop.
- **`npm run clean:recordings` now targets the bridge recordings directory.** The
  root helper previously checked a nonexistent root-level `recordings/` folder,
  so its dry run misleadingly reported nothing while bridge captures remained.
- **Detail scope is always pinned to one node.** The redundant sidebar "Active
  system" selector and its unstable "Auto (latest)" option are gone. The global
  Scope picker is now the only selector; it opens or changes a concrete system,
  so a multi-vehicle stream cannot make the detail view alternate between nodes.
- **Linux/arm64 Docker is now the SITL acceptance baseline** (ADR-0031). This
  keeps Apple Silicon development rigs on the same userspace as Linux deployment
  targets; native macOS SITL remains best-effort exploration, never the source of
  a validation claim.
- **Mission requests route per MAVLink system endpoint.** The UDP adapter no
  longer replies to whichever vehicle sent most recently: it remembers the
  endpoint that last carried each `sysId:compId`, and mission requests, retries
  and ACKs use that route. A missing or stale route fails explicitly rather than
  leaking a request to a neighbouring vehicle (ADR-0030).
- **Per-node mission plans are published** — `useVehicleFeed` cached a
  `MissionPlan` per system but surfaced only the selected one, so any other
  node's mission arrived, was stored, and was invisible. Now exposed as
  `missions`, keyed by system, published on arrival and on TTL eviction.
- **Shared map primitives extracted** to `apps/gcs/src/map/mapAdapter.ts` —
  `toLngLat`, `buildStyle` and the marker-element factories, now that a second
  map consumes them. The marker factories take an optional colour and default to
  the single-node appearance. `addOverlayLayers` deliberately stayed in
  `MapPanel.tsx`: it hard-codes one track and one route, and the fleet map needs
  a data-driven layer instead. The basemap picker split out of `MapControls` as
  `BasemapControl`, since Follow and Track up have no meaning on a fleet map.

### Added
- **Deterministic CI validation.** GitHub Actions now runs all JavaScript,
  TypeScript, and ESP32-native tests plus GCS/HUD builds on pull requests and
  pushes to `main`. The fast real-SITL motion fixture runs through
  `test:bridge`; resource-heavy live Docker SITL remains a manual evidence gate.
- **Mixed-SITL session handoff.**
  [docs/session_handoff_2026-08-12.md](docs/session_handoff_2026-08-12.md)
  records the completed smoke run, remaining acceptance evidence, platform
  constraints, and the recommended motion-validation follow-on.
- **Per-node fleet-map recenter control.** Each roster row now has a crosshair
  beside its visibility eye that centers the fleet camera on that vehicle without
  opening its detail view or changing the current zoom.
- **Command-validation roadmap.**
  [docs/mavlink_command_validation.md](docs/mavlink_command_validation.md) defines
  a SITL-first, target-routed path from read-only requests through mission and
  mode operations, and keeps browser-GCS authority separate from a future ESP32
  companion-computer role.
- **ArduPilot SITL testing runbook.**
  [docs/ardupilot_sitl_testing.md](docs/ardupilot_sitl_testing.md) records the
  mixed Copter/Plane topology, the exact bridge acceptance checks, frame and
  state persistence caveats, and why loading a mission is not the same as
  commanding a vehicle to fly it.
- **Mixed ArduPilot SITL acceptance harness.** `npm run sitl:up` starts pinned
  ArduPilot 4.6.2 ArduCopter (`1:1`) and ArduPlane (`2:1`) simulators alongside
  the bridge, each with a distinct seeded mission. A versioned sanitized MAVLink
  v2 fixture protects the two-system decoder/replay path without requiring Docker
  in the ordinary Node test suite. This validates one simulated mixed-fleet
  scenario only; field and broader multi-node claims remain gated (ADR-0030).
- **Fleet view — the multi-node picture** (ADR-0029,
  [target](docs/multi_node_awareness.md)). A roster plus its own unified map
  showing every node on the link, with per-node colour carried across the marker,
  route line, waypoint badges and roster swatch. Freshness renders as marker
  opacity and as a band plus an age per row; a node with no fix is rostered but
  not drawn. Each row carries an eye that takes the node off the map entirely
  (marker, route and waypoints) while leaving it listed, and an arrow into its
  detail view. "Load mission" is per node, exercising the per-vehicle
  `target_system` addressing that a single-node UI could never reach.
  `App.tsx` became a shell owning `useVehicleFeed` — the feed must outlive the
  view switch, or navigating would drop the link and every trail — with the
  original UI moved to `NodeView.tsx` unchanged. The seam between them is one
  callback that pins `selectedSystem`. Built against the synthetic fleet only;
  nothing here is a claim that multi-node is validated.
- **A global header and scope picker.** "Ground control" and one node picker now
  sit above both views rather than inside one, with each view contributing its
  own chrome (the fleet back-link and Views, or the fleet heading) to a subbar
  beneath. The picker names the concrete node on screen, or `Nodes…` for the
  fleet; it is the only detail selector so a live multi-node feed cannot switch
  the operator's view behind their back.
- **The node id ↔ system key seam** (`parseMavlinkNodeId`, `systemKeyFromNodeId`
  in `packages/gcs-core/src/nodes.ts`). `NodeIdentity.id` is `mavlink:1:1` while
  every fold key, `knownSystems` and `selectedSystem` are `1:1`, and nothing
  converted between them — while `NodeIdentity.label` coincidentally equalled the
  key, so the wrong implementation worked until a node got a real callsign.
  Written and read in one file, and tested against that coincidence.
- **Multi-node / TAK-style awareness recorded as a future phase** (ADR-0026,
  [target](docs/multi_node_awareness.md)). Meshtastic and other CoT participants on
  one shared picture, gated on the single-node system being robust, tested and
  field-validated first. Notes what is already multi-node (per-system folds, the
  bridge roster, duplicate-transmitter detection) versus what actually changes
  (identity above `sysId:compId`, a node model above `VehicleState`, presentation
  for many), and records the build pattern to follow: portable logic in isolation,
  tested hard, integrated against a portable mock, embellished last.
- **Video sidecar, first slice** (ADR-0021, [notes](docs/video_pipeline_notes.md)).
  A Video view in the GCS, transport-agnostic health folds in
  [gcs-core/video.ts](packages/gcs-core/src/video.ts) (fps, bitrate, frame age,
  stall detection, reconnects — fields a transport cannot measure stay `null`
  rather than being faked), and a `multipart/x-mixed-replace` adapter. New
  [apps/video-bridge](apps/video-bridge) serves a moving test pattern with PNG
  frames encoded via `zlib`, so the whole path runs with no capture hardware, no
  media server and no ffmpeg: `npm run mock:video`.
  The adapter demuxes the stream with `fetch` rather than pointing an `<img>` at
  it — an `<img>` renders every part but fires `load` only for the first, so it
  reports one frame and then looks permanently stalled. Demuxing costs
  CORS-independence, so a blocked fetch falls back to `<img>` with degraded
  statistics; a picture without numbers beats an error with neither.
  MediaMTX, WHEP, and the analog/UVC capture paths are deliberately deferred —
  each needs hardware or infrastructure that is not present, and each is a new
  adapter behind the same port.
- **`npm run clean:recordings`** — the startup retention sweep (ADR-0023) on
  demand, with `--dry-run` and `--all`. The root script invokes node directly
  because a nested `npm run` swallows `--` flags, which briefly made `--dry-run`
  delete files; the tool now announces its mode on the first line.
- **MapLibre GL replaces Leaflet as the map renderer** (ADR-0024), unlocking
  rotation, track-up and camera tilt — none of which Leaflet supports at all. The
  swap touched only [MapPanel.tsx](apps/gcs/src/map/MapPanel.tsx) and the tile
  catalogue, which is what the single-adapter constraint was for. All six raster
  basemaps carry over. 3D *terrain* and extruded buildings are deliberately
  deferred as a nice-to-have: they need DEM and vector tile sources, which is an
  infrastructure decision rather than a rendering one.
- **Map camera controls: Follow, Track up, 3D, Reset view** (ADR-0025). Each owns
  exactly one camera axis — centre, bearing, pitch — and taking that axis by hand
  releases the control, so manual interaction always wins instead of being
  overwritten on the next telemetry frame. Track up is a modifier on Follow —
  enabling it enables Follow, since orienting to a vehicle you are not centred on
  serves nothing.
  3D is exclusive with Follow and Track up: those re-anchor the camera every frame,
  which leaves a tilted view impossible to look around. Reaching for the map hands
  the camera over: a mousedown drops the vehicle-anchored modes so the drag that
  follows just works, rather than being refused or overwritten on the next frame.
- **Session recording on by default, with retention** (ADR-0023). The bridge writes
  `recordings/session-<timestamp>.jsonl` every run. A per-run byte cap
  (`MAVLINK_BRIDGE_RECORD_MAX_MB`, 256) stops recording rather than rotating, and a
  startup sweep prunes the directory by age (`_RETAIN_DAYS`, 7) then total size
  (`_TOTAL_MAX_MB`, 1024), oldest first. Pruned files are logged by name, size and
  reason; the sweep never touches the active file or non-`.jsonl` files. Disable with
  `MAVLINK_BRIDGE_RECORD=0`; recording is skipped automatically while replaying.
  [apps/mavlink-bridge/README.md](apps/mavlink-bridge/README.md) documents the full
  configuration surface.
- **Record and replay for the MAVLink bridge** (ADR-0022). The bridge is now a
  transport-agnostic [core](apps/mavlink-bridge/src/bridgeCore.js) plus swappable adapters:
  [UDP](apps/mavlink-bridge/src/udpIngress.js) and
  [replay](apps/mavlink-bridge/src/replayIngress.js) ingress share one
  `start(onDatagram) => stop` shape, with a JSONL `RecordingPort` in
  [recording.js](apps/mavlink-bridge/src/recording.js). Recordings hold raw wire bytes, so a
  replay re-runs the decoder. `npm run replay:bridge` reproduces a recorded session
  with no vehicle, sender, or UDP socket attached — a
  contract test asserts the replayed envelope stream matches the live one exactly.
- **Duplicate-transmitter detection.** The bridge warns when one `sysId:compId` arrives from
  more than one source endpoint, and the sample sender now binds a fixed source port as a
  single-instance lock and refuses to start twice. Two senders claiming one vehicle merge
  into a single aircraft with contradictory telemetry, which presents as a sawtooth track
  rather than as an obvious configuration fault.
- **MAVLink frame checksums.** Binary frames are validated with the X.25 CRC and per-message
  `CRC_EXTRA`; a failed checksum resyncs one byte at a time rather than trusting the length
  field of a frame that may not be real. The CRC primitive is pinned to the published
  CRC-16/MCRF4XX check vector.
- Stale systems are evicted from the bridge roster after
  `MAVLINK_BRIDGE_SYSTEM_TTL_MS` (default 10s) so vehicles that go quiet leave the selector.
- [ESP32 firmware project](apps/esp32) with a PlatformIO `esp32dev` target and a portable C++
  HUD core. The same heading resolver and primary-flight-display scene composition compile on
  the host via `npm run test:esp32`; `npm run preview:esp32` writes an SVG frame for local visual
  validation before any hardware is connected (ADR-0019).
- Monorepo layout: the existing Vite validation harness now lives in
  [apps/web](apps/web), while [apps/desktop](apps/desktop) is an
  isolated local checkout location for the Dear ImGui + React desktop experiment (ADR-0018).
- **Static parameter playground** at the `/playground` route
  ([PlaygroundView.tsx](apps/web/src/pages/PlaygroundView.tsx)): sliders for roll, pitch, heading,
  airspeed, and stall speed drive the PFD, 3D orientation, and predictive-trajectory
  instruments from a single frozen "moment in time." Inputs are packed into a real sanitized
  sample by [buildStaticSample](apps/web/src/stream/staticSample.ts) and resolved by the exact
  production logic stack, with a derived-values panel mirroring the resolver outputs — a visual
  validation surface alongside the numeric replay tests (ADR-0016).
- `react-router-dom` with `HashRouter`; the app now has two routes, `/validator` (the existing
  dashboard, moved verbatim to [ValidatorView.tsx](apps/web/src/pages/ValidatorView.tsx)) and
  `/playground`, with a top nav ([App.tsx](apps/web/src/App.tsx)).
- Reusable [ParameterSlider](apps/web/src/components/ParameterSlider.tsx) control (label + range +
  clamped numeric readout).
- Documentation set: [docs/architecture.md](docs/architecture.md) (data flow, module map,
  conventions), plus fleshed-out [heading](docs/heading_indicator.md),
  [attitude/horizon](docs/attitude_and_horizon_indicator.md), and
  [flight path](docs/flight_path_marker.md) references.
- Architecture Decision Record log at [docs/decisions.md](docs/decisions.md), seeded with
  ADR-0001…0008 and extended with ADR-0009…0012 for this session's rendering decisions.
- This changelog.
- Nose-relative 3D path (`ForwardPathPoint` / `forwardPoints`) on `TrajectoryResolution`,
  integrated in [trajectory.ts](apps/web/src/logic/trajectory.ts) for perspective projection (ADR-0010).
- Predictive trajectory reworked into a forward-looking **perspective corridor**: pinhole
  camera above the flight path, converging floor grid, 1-second depth gates, and a two-tone
  surface — a "road to the horizon" whose vanishing point is the boresight.
- **Bore-sighted, two-layer HUD** framing for the corridor: an earth-referenced world layer
  (grid + horizon) and a flight-path layer roll in opposite directions about a fixed
  boresight cross, with pitch driving the path's camera height (ADR-0011).
- Climb-slope surface colouring: the corridor reads **sky when rising, ground when falling**,
  flipping only at a real crest/trough (ADR-0012).
- **Flight Path Recorder** — a third second-row instrument
  ([HudFlightPathRecorder.tsx](apps/web/src/components/HudFlightPathRecorder.tsx)): an orbitable
  (drag-to-rotate, scroll-to-zoom) fixed 3D world showing the accumulated breadcrumb of where
  the aircraft has been, with a dashed ground shadow, altitude drop-lines, current-position
  marker, and an N/E/Up gnomon. Distinct from the forward-looking predictive corridor.
- Hybrid position resolver [position.ts](apps/web/src/logic/position.ts): prefers absolute
  `GLOBAL_POSITION_INT` lat/lon/alt projected to a local ENU frame, falling back to NED
  velocity integration, tagged via `source` (ADR-0013, ADR-0015). Pure `resolvePositionStep`
  fold + batch `resolveTrack(samples[])` for log/replay analysis.
- Bounded accumulation hook [useFlightTrack.ts](apps/web/src/stream/useFlightTrack.ts) — ring buffer
  over the shared feed; full track for finite/replay sources, rolling window for live (ADR-0014).
- `GLOBAL_POSITION_INT` `lat`/`lon`/`alt`/`relative_alt` added to `GlobalPositionIntSample` +
  sanitizer ([telemetry.ts](apps/web/src/logic/telemetry.ts)) and the MAVLink registry
  ([mavlinkInputs.ts](apps/web/src/constants/mavlinkInputs.ts)).
- Synthetic mission generator `buildSyntheticMissionSamples`
  ([telemetrySource.ts](apps/web/src/stream/telemetrySource.ts)) — integrates the analytic velocity into
  an absolute LLA track so the replay source exercises the GPS path; round-trips through
  `resolveTrack` to degE7 quantization.
- Known-answer suite [position.test.ts](apps/web/src/logic/position.test.ts) (ENU projection, velocity
  fallback, source selection) plus a mock↔resolver round-trip test.

### Changed
- **Predictive trajectory turn/climb now derive from body-rate Euler kinematics** instead of
  static bank/pitch angles ([trajectory.ts](apps/web/src/logic/trajectory.ts), ADR-0017). Turn rate is
  `ψ̇ = (sin φ·q + cos φ·r)/cos θ` from `ATTITUDE.pitchspeed`/`yawspeed` (no more
  `yawRate + g·tan φ/V` double-count); a held bank with no rotation no longer fabricates a turn.
  Climb comes from the velocity vector's flight-path angle (`γ₀ = asin(vs/V)`, bending at
  `γ̇ = cos φ·q − sin φ·r`), so a level nose-up coordinated turn reads as level. New resolution
  fields: `coordinatedTurnRateRadPerSec` (slip/skid reference), `climbAngleRateRadPerSec`,
  `flightPathAngleDeg`. `g·tan φ/V` is retained as the attitude-only fallback.
- `ATTITUDE.pitchspeed` (`pitchSpeedRadPerSec`) plumbed into `AttitudeSample` + sanitizer
  ([telemetry.ts](apps/web/src/logic/telemetry.ts)).
- Playground inputs split into **airframe** (roll, pitch, pitch-rate, yaw-rate) and **velocity
  vector** (airspeed, flight-path angle, heading) groups, with a coordination readout comparing
  actual vs coordinated turn rate ([PlaygroundView.tsx](apps/web/src/pages/PlaygroundView.tsx)).
- Mock generator ([telemetrySource.ts](apps/web/src/stream/telemetrySource.ts)) now emits **body angular
  rates** (`pitchspeed`/`yawspeed` via the inverse Euler transform of its analytic attitude
  motion) plus `airSpeedMps`, so the live/replay feed is consistent with the corrected trajectory
  kinematics (ADR-0017). Previously `yawspeed` carried the earth-frame heading rate — a
  now-visible mismatch under the body-rate model, and pitch rate was absent (spurious pitching in
  turns).
- `resolvePredictivePath` ([flightPath.ts](apps/web/src/logic/flightPath.ts)) now rotates its CTRV arc at
  the **earth-frame heading rate** `ψ̇ = (sin φ·q + cos φ·r)/cos θ` rather than treating body
  `yawspeed` as a heading rate directly — so it and the trajectory corridor interpret `yawspeed`
  identically. The Euler transform is factored into shared helpers `headingRateFromBodyRates` /
  `climbAngleRateFromBodyRates` ([attitude.ts](apps/web/src/logic/attitude.ts)). No-op for wings-level
  frames (ψ̇ = r there), so the replay fixtures are unchanged.
- **Airspeed is now a first-class telemetry field.** `airSpeedMps` added to `VfrHudSample` +
  sanitizer ([telemetry.ts](apps/web/src/logic/telemetry.ts)) and resolved by `resolveScalarTelemetry`
  ([flightPath.ts](apps/web/src/logic/flightPath.ts), new `airSpeedMps`/`airSpeedKnots`/`airSpeedSource`).
  The air-relative physics in [trajectory.ts](apps/web/src/logic/trajectory.ts) — stall flag, forward
  reach, climb geometry, bank-turn denominator — now key off airspeed, falling back to
  groundspeed when absent; groundspeed still drives the ground-track/wind-drift term. Corrects a
  stall-vs-groundspeed conflation valid only in still air (ADR-0016). Additive: existing callers
  and replay frames are unchanged by the fallback.
- `HudPredictiveTrajectory` accepts an optional `config` prop to override the trajectory
  integrator (e.g. a playground stall speed); default behavior is unchanged.
- Second-row grid expanded from two boxes to **three** with graduated breakpoints
  (`repeat(3)` → `repeat(2)` ≤1320px → `1fr` ≤860px). The boxes now size to their content
  (shorter `620×480` viewBox, `height:auto`) instead of matching the first row's height.
- Renamed `docs/attiude_and_horizon_indicator.md` →
  [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md)
  (fixed typo) and updated all references.
- 3D orientation indicator rebuilt around an explicit aerospace body frame and a fixed chase
  camera, with a recognizable aircraft model and a static ground grid replacing the compass
  ring and X/Y/Z/D axis triad (ADR-0009).
- Corridor start marker raised toward the boresight; the arrow is de-emphasized and now fades
  as the drawn path lengthens; the centerline fades from near to far.

### Fixed
- **External stream froze after ~8 seconds.** The bridge forwarded an unbounded `sequence`,
  but the browser validates it as a uint8, so once the sample sender's counter passed 255
  every envelope was rejected as malformed. Sequence now wraps at the bridge boundary, as the
  wire field does.
- **VFR_HUD decoded from the wrong payload offsets.** MAVLink orders payload fields by size
  rather than by XML declaration, so heading was read from the low bytes of `alt` and climb
  reinterpreted heading+throttle as a float. The accompanying test had been written to match
  the broken layout, so it passed; both are corrected.
- **Selecting a system in the GCS view reconnect-looped the WebSocket.** The filter object was
  rebuilt every render and fed a `useMemo` that `useTelemetryFeed` keys its effect on, so each
  health tick tore down the socket. The filter is now read through a stable getter, so changing
  vehicles filters the live stream instead of rebuilding it.
- **Partial messages no longer clobber each other.** Samples merge per source system, so a
  `VFR_HUD` frame can't blank the attitude and two vehicles can't fuse into one aircraft.
  Sanitizing writes absent fields as explicit `undefined`, so the merge skips those rather than
  erasing a known-good value (e.g. a `GLOBAL_POSITION_INT` without lat/lon wiping the last fix).
- **Stream health reported a running packet count as a rate**, producing a sawtooth readout;
  the rate is now sampled per tick.
- **Sample sender ignored heading**, emitting velocity as due-north with a zero east component,
  so the GPS track ran straight regardless of the turn. Ground speed is now projected onto the
  heading, the sender emits absolute lat/lon, and bank is derived from the turn rate so the
  profile stays coordinated.
- Predictive trajectory vertical axis was inverted (SVG y-down vs the model's y-up), so a
  climb pointed the marker down and a descent up. Corrected the projection sign in
  [HudPredictiveTrajectory.tsx](apps/web/src/components/HudPredictiveTrajectory.tsx).
- Orientation indicator roll and pitch were cross-wired — the vehicle model was authored with
  the nose along +Y while the rotation code assumed the aerospace +X-forward frame — so the
  model tipped in the wrong axes (ADR-0009).

### Known issues
- Components still re-implement the pitch/roll→screen transform independently rather than
  consuming a shared logic helper (ADR-0008). The predictive corridor and orientation panel
  are now aligned to the attitude indicator by construction and verified numerically, but the
  underlying duplication — and its inversion risk — remains until the transform is centralized.

## [2026-07-22] — First functional pass (`355baff`)

> Commit message: "first pass - logic is okay, rendering is inverted in some places."

### Added
- Full resolver stack: heading, attitude/horizon, scalar telemetry, 2D track, 3D flight
  path angle, kinematic predictive path (linear + CTRV turn-aware), and an integrated
  predictive trajectory blending heading/track/bank/pitch with wind-drift and stall cues.
- SVG HUD components: primary flight display (heading tape + attitude), 3D orientation
  indicator, and predictive trajectory view.
- Telemetry source adapter (`synthetic-replay` and `live-mock`) plus the
  `useTelemetryFeed` React hook.
- Known-answer replay validation frames and Vitest suites across all logic modules.
- Canonical MAVLink field registry ([mavlinkInputs.ts](apps/web/src/constants/mavlinkInputs.ts)).

### Known issues
- Rendering inverted in some places (attitude sign-convention duplication — see ADR-0008).

## [2026-07-13] — Project bootstrap (`9315edc`)

### Added
- Initial Vite + React 19 + TypeScript 6 scaffold, ESLint flat config, and the docs
  skeleton.
