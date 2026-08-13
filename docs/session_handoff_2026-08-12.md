# Session handoff — mixed MAVLink SITL

**Date:** 2026-08-12  
**Purpose:** Resume mixed ArduCopter + ArduPlane validation without rediscovering
the architecture, local setup, or current acceptance boundary.

## Where the project stands

The browser GCS, MAVLink bridge, deterministic mock fleet, and Docker-based
mixed ArduPilot SITL harness are all in place.

- The **mock fleet** remains the fast, deterministic regression layer. It
  generates known MAVLink traffic without Docker or ArduPilot and is the right
  place for pure fold, roster, map-data, and UI-adjacent regression tests.
- The **SITL harness** is the real-producer acceptance layer. It runs pinned
  ArduPilot 4.6.2 ArduCopter (`1:1`) and ArduPlane (`2:1`) in separate Linux
  Docker containers, each forwarding through MAVProxy to the bridge.
- The initial live SITL smoke run succeeded: both systems reached the browser
  GCS, appeared in the fleet roster/map near CMAC (Canberra, Australia), and
  returned independent seeded missions.
- Formal mixed-SITL acceptance completed on 2026-08-13. The result and two
  non-blocking UI/replay follow-ups are recorded below.

Do **not** copy the mock vehicle generator into SITL. That would hide the very
ArduPilot behavior the SITL layer is meant to expose. Port scenario intent
(system IDs, mission shape, expected outcomes), not synthetic telemetry.

## Run it locally

For deterministic mock testing from the repository root:

```bash
npm run gcs:mock
```

For mixed real-ArduPilot testing, start the Compose stack in the background and
run the GCS with one command:

```bash
npm run gcs:sitl
```

Open the GCS at Vite's printed address (normally `http://localhost:5174`) and
use `ws://localhost:8080/telemetry`. Stop the detached SITL services after the
GCS exits with `npm run sitl:down`.

Useful commands:

```bash
npm run sitl:up
npm run sitl:logs
npm run sitl:down
npm run build:gcs
npm run test --workspace @flight-path-hud/gcs-core
```

The first Docker build is intentionally large: it clones ArduPilot, initializes
submodules, installs prerequisites and MAVProxy, and compiles SITL. Subsequent
builds use Docker cache. Docker images are local cache, not repository assets.

## Platform constraint

The supported acceptance baseline is Linux/arm64 containers through Docker
Desktop, including on Apple Silicon Macs. Native macOS SITL is best-effort
exploration only—not the source of an acceptance claim. See
[ADR-0031](decisions.md#adr-0031-linux-containers-are-the-sitl-baseline-native-macos-is-best-effort).

The Compose bridge keeps Linux `node_modules` in a Docker volume. This prevents
a container `npm ci` from overwriting macOS-native Vite/Rolldown dependencies on
the host. If the host GCS reports a missing Darwin Rolldown binding, stop the
stack, run `npm ci` at repository root on the Mac, then restart the GCS.

## Important implementation details

### Transport and missions

- MAVProxy is an upstream MAVLink forwarding/fan-out hop; the custom bridge is
  still responsible for WebSocket delivery, normalized state, recordings,
  replay, roster/TTL and target-routed mission synchronization.
- Outbound mission pulls route to the source endpoint stored for the requested
  `sysId:compId`, never to the latest UDP sender. Missing/stale routes fail
  explicitly. See [ADR-0030](decisions.md#adr-0030-udp-mission-replies-are-routed-by-mavlink-system-not-sender-recency).
- The SITL-only mission seeder waits for both `HEARTBEAT` and `HOME_POSITION`
  before upload. A heartbeat alone can precede GPS initialization and previously
  allowed mission item zero to appear at temporary `0,0`.
- Both simulator processes start at ArduPilot's `CMAC` location:
  `-35.363261, 149.165230`. Copter has three seeded items; Plane has four.
- Loading a mission is read-only. It neither arms the vehicle nor starts AUTO;
  stationary vehicles are expected in the current scenario.

### GCS behavior recently corrected

- Detail scope is always a concrete system; the unstable “Auto/latest” picker
  was removed.
- The fleet roster has an eye to hide a node from the map, a crosshair to center
  the fleet map on it without changing scope/zoom, and an arrow to open detail.
- Trails advance only on `GLOBAL_POSITION_INT`. A jump greater than 1 km starts
  a new breadcrumb/ENU epoch, preventing a startup placeholder coordinate from
  creating a false intercontinental route.

## Formal acceptance checklist

1. Start the stack and browser GCS. Confirm both `1:1` and `2:1` are live and
   each has an independent position, instruments and map marker.
2. Load Copter then Plane missions, and repeat Plane then Copter. Confirm the
   plans remain associated with their addressed systems.
3. Stop only Plane:

   ```bash
   docker compose -f apps/mavlink-bridge/sitl/compose.yml stop plane
   ```

   Confirm Plane ages/stales and is evicted while Copter remains live. Restart
   Plane and confirm it reappears without restarting the GCS.
4. Stop the stack. Select a short successful bridge recording from
   `apps/mavlink-bridge/recordings/`, then replay it:

   ```bash
   MAVLINK_BRIDGE_REPLAY_FILE=recordings/<session>.jsonl npm run replay:bridge
   ```

   Confirm the same roster. Mission overlays cannot currently be reconstructed
   by standalone replay because recordings contain inbound MAVLink datagrams,
   not the browser's outbound mission request that starts the bridge mission
   transaction. Do not enable recording during replay.
5. Curate a small, sanitized real-SITL capture into the versioned fixture and
   extend the existing fixture tests to prove independent IDs/state/missions and
   normalized replay parity.

## Acceptance result — 2026-08-13

The mixed-SITL acceptance checklist passed:

- Both `1:1` and `2:1` appeared live with independent telemetry and map markers.
- Mission pulls succeeded in both request orders. Copter retained three items
  (`0–2`) and Plane retained four (`0–3`); neither plan crossed system scope.
- With only Plane stopped, `2:1` aged to stale and was evicted after the GCS's
  60-second TTL while `1:1` remained live and usable. Plane then reappeared live
  after restart, without a browser reload, and its four-item mission loaded again.
- A bounded 23-second real-SITL capture
  (`session-2026-08-12T18-12-24-525.jsonl`, about 560 KB) replayed 1,519
  datagrams and briefly reproduced both roster entries in the browser.
- The checked-in sanitized fixture `mixed-mavlink-v2.jsonl` and its tests prove
  independent IDs, positions, mission counts/items, and normalized replay parity.

Two follow-ups were identified but do not invalidate transport acceptance:

- Waypoint `0` is the active mission-home item at the stationary vehicle's
  position, so its yellow badge overlaps the vehicle marker. Plane's assigned
  sand/amber identity colour is also visually close to the yellow active-item
  colour, making the fleet overlay ambiguous.
- Raw recording captures inbound MAVLink datagrams but not the browser's outbound
  mission request. Standalone replay therefore reproduces the two-node roster but
  cannot reconstruct cached mission overlays with the current mission router.

Future harness optimization: startup latency is dominated by the bridge running
`npm ci` before opening its WebSocket, browser exponential reconnect backoff, and
each concurrently launched vehicle withholding forwarding until its independent
`HEARTBEAT`/`HOME_POSITION`/three-second delay/mission-upload sequence completes.
Optimize only with timing evidence, preserving deterministic mission seeding and
the guard against waypoint zero being captured at temporary `0,0`. See the
startup-latency note in `ardupilot_sitl_testing.md` for candidate changes.

## Recommended next milestone

After the checklist above, add a **separate test-only SITL motion scenario**.
Use real ArduPilot mission/mode control from an explicit validation script or
authorized GCS workflow; do not inject synthetic positions through the bridge.
That scenario should make both vehicles move enough to exercise map trails and
instruments, while remaining separate from the browser GCS's currently
read-only authority model.

Only after that should browser command/control capabilities be introduced, using
the staged approach in [mavlink_command_validation.md](mavlink_command_validation.md).

## Next steps: autonomous coordination and swarm validation

Treat swarm behavior as a **coordination domain above individual vehicles**, not
as another fleet-map feature or a larger mission download. Follow this sequence:

1. Finish mixed-SITL acceptance and capture/replay evidence.
2. Add a real SITL motion scenario for each vehicle independently.
3. Validate narrowly scoped control primitives in SITL: mode changes,
   arm/disarm, takeoff where applicable, mission start/stop, and failsafe
   observation.
4. Introduce a coordination model: group membership, leader/follower roles,
   desired relative offsets, intent, separation constraints, health/link state,
   and explicit degraded behavior.
5. Validate formation/swarm scenarios in SITL before attempting hardware.

The browser GCS should plan, authorize, observe and supervise that coordination;
it must not become the real-time flight-control loop. Tight formation keeping,
collision avoidance and local failsafes belong onboard—within ArduPilot and, if
needed later, a purpose-built companion-computer component. The ESP32 HUD may
eventually display relative/swarm cues but remains a read-only onboard display,
not a coordination authority.

## Reference documents

- [ArduPilot SITL runbook](ardupilot_sitl_testing.md)
- [Multi-node architecture and evidence gate](multi_node_awareness.md)
- [MAVLink command-validation roadmap](mavlink_command_validation.md)
- [Architecture decisions](decisions.md)
- [Changelog](../CHANGELOG.md)
