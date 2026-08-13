# ArduPilot SITL Testing Nuances

This is the project runbook for exercising the GCS bridge with **real ArduPilot
SITL MAVLink**, not for learning to fly a simulated vehicle. It complements the
official [Using SITL guide](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html);
when they disagree, ArduPilot's documentation wins.

## The project scenario

`pnpm sitl-test:up` runs three Linux containers:

| Service | Vehicle | MAVLink identity | Purpose |
| --- | --- | --- | --- |
| `copter` | ArduCopter, default `quad` frame | `1:1` | Mixed-fleet telemetry and a 3-item mission pull |
| `plane` | ArduPlane, default `plane` frame | `2:1` | Mixed-fleet telemetry and a 4-item mission pull |
| `bridge` | — | GCS `255:190` for mission reads | UDP ingest and WebSocket at `ws://localhost:8080/telemetry` |

The two vehicles run as **separate** `sim_vehicle.py`/MAVProxy processes. This is
intentional: ArduPilot's `--count` swarm launcher is for vehicles of the *same*
type, whereas this acceptance target must mix Copter and Plane. Each process has
its own `MAV_SYSID`, UDP source endpoint and seeded waypoint file. A SITL-only
seeder waits for the vehicle heartbeat **and `HOME_POSITION`** before completing
the normal MAVLink mission count/request/item/ack transaction; a heartbeat alone
can precede GPS/home initialization and yield a temporary `0,0` mission-home
item. MAVProxy starts its persistent UDP forwarding role only after that upload.

Both simulators explicitly start at ArduPilot's `CMAC` location near Canberra,
Australia. The seeded Copter and Plane routes use that same local area, while
remaining intentionally distinct in waypoint count, route shape, and altitude.

MAVProxy forwards each simulator's MAVLink stream to `bridge:14550` over the
Compose network. The browser never speaks MAVLink directly; it connects only to
the bridge's WebSocket on host port 8080.

## What SITL proves — and what it does not

Passing this scenario proves that the bridge can receive and decode real MAVLink
v2 frames from two ArduPilot vehicle types; maintain independent per-system
state; route an explicit mission pull, retries and final ACK to the addressed
vehicle endpoint; record raw bytes; and replay the resulting bridge recording.

It does **not** prove airworthiness, radio/serial behavior, video timing,
network-loss resilience beyond the exercised container stop/start case, or real
hardware compatibility. It is a bridge and protocol acceptance gate, not a
flight test.

## Start and observe

From the repository root:

```bash
BUILDKIT_PROGRESS=plain pnpm sitl-test:up
```

The first build downloads ArduPilot and its submodules, installs its supported
Ubuntu prerequisites, installs pinned MAVProxy `1.8.74` (which `sim_vehicle.py`
starts as the forwarding process), and compiles SITL. Docker caches those layers
locally; neither the image nor the ArduPilot checkout belongs in Git. On an Apple
Silicon Mac this is Linux/arm64 under Docker Desktop, which is the project's
supported SITL baseline (ADR-0031), not a native macOS build.

### macOS host dependencies versus Linux bridge dependencies

The bridge container bind-mounts this repository for source access, but its
`node_modules` live in a Docker-managed volume. This is required on macOS:
Vite/Rolldown has native bindings, and a Linux `pnpm install --frozen-lockfile` must never write into the
host's macOS `node_modules` directory. If a previous container run did overwrite
it, stop the stack and run `pnpm install --frozen-lockfile` from the repository root on the Mac, then
start the GCS again. A missing `@rolldown/binding-darwin-arm64` error means this
host dependency repair is required.

In a second terminal start the GCS:

```bash
pnpm --filter @flight-path-hud/gcs dev
```

Keep the GCS WebSocket URL at `ws://localhost:8080/telemetry`. Use
`pnpm sitl-test:logs` to follow container output, and stop everything with
`pnpm sitl-test:down`.

`pnpm sitl-test:message-interval` runs a separate bridge-path acceptance scenario.
It enables interval commands only inside the Compose override, sets distinct
`ATTITUDE` cadences on `1:1` and `2:1`, measures monotonic WebSocket arrival
intervals, and restores both streams to their autopilot defaults in cleanup.
Copter validates a reduction to 2 Hz. Plane validates an increase to 10 Hz:
MAVProxy's legacy 4 Hz stream remains additive on Plane, so accepting a slower
per-message interval does not reduce its aggregate `ATTITUDE` cadence.

Acceptance passed on 2026-08-13 against ArduPilot 4.6.2. Copter measured a
500.0 ms median interval with a 505.3 ms maximum; Plane measured 100.2 ms with a
105.0 ms maximum. Every measured interval was within tolerance. Both vehicles
accepted the cleanup request restoring their autopilot-default intervals.

`pnpm sitl-test:parameter-write` validates the first reversible write family.
The bridge feature flag exists only in its Compose override. The controller reads
both original `LOG_DISARMED` values, toggles one exact target at a time, performs
an independent read-back, proves the peer remains unchanged, and restores and
re-reads both originals in unconditional cleanup.

Acceptance passed on 2026-08-13 against ArduPilot 4.6.2. Copter and Plane each
changed from `0` to `1` without affecting the peer, then both restored to `0`.

## Acceptance checklist

1. The GCS fleet roster lists `1:1` and `2:1`, with no bridge decode errors for
   expected traffic.
2. Select each node through the global Scope picker. The detail view must remain
   pinned to the selected system; it must never switch merely because the other
   vehicle reports a newer frame.
3. Click **Load mission** for `1:1` and confirm its three waypoint route. Click
   it for `2:1` and confirm its four waypoint route. Repeat in reverse order.
   A plan must never appear under the wrong system.
4. Stop only Plane:

   ```bash
   docker compose -f apps/mavlink-bridge/sitl/compose.yml stop plane
   ```

   Plane must age/stale and be evicted while Copter stays live. Start Plane again
   and confirm it recovers without a browser reload.
5. Stop the stack. Locate the bridge recording in
   `apps/mavlink-bridge/recordings/`, replay it from the repository root with
   `MAVLINK_BRIDGE_REPLAY_FILE=recordings/<file> pnpm replay:bridge`, and
   confirm the same two-node roster and cached mission overlays appear. Replay
   passively folds captured `MISSION_COUNT`/`MISSION_ITEM_INT` transactions; it
   sends no mission requests or acknowledgements and keeps mission loading
   disabled.

## Operator gotchas

### Startup latency is mostly harness sequencing

The several-second delay before the GCS connects and the vehicles appear is not
primarily MAVLink throughput. It currently comes from three deliberate or
incidental startup stages:

- The Compose bridge runs `pnpm install --frozen-lockfile` on every container start before opening its
  WebSocket. With a warm dependency volume this still took about four seconds in
  the 2026-08-13 validation run.
- While the bridge is unavailable, the browser retries with exponential delays
  of 500 ms, 900 ms, 1.62 s, 2.92 s, then up to 5 s. A bridge that becomes ready
  just after an attempt can therefore sit idle until the next retry.
- Copter and Plane containers start concurrently, but each withholds its MAVProxy
  forwarding independently until SITL accepts a seeded mission. The seeder waits
  for TCP, `HEARTBEAT`, `HOME_POSITION`, a fixed three-second mission-storage
  delay, and the complete mission upload. Different home/GPS initialization times
  make the vehicles appear one after the other even though they were launched in
  parallel.

This sequencing currently favors deterministic mission seeding over startup
speed and remains the acceptance baseline. A future harness optimization should
measure each stage, then consider baking bridge dependencies into an image,
starting telemetry forwarding independently of seeding, replacing the fixed
three-second wait with an explicit readiness/retry transaction, and shortening
initial browser reconnect backoff. Any change must preserve reliable mission
item zero coordinates and target-routed mission synchronization.

### A loaded mission is not a flying mission

The seeded `*.waypoints` files are uploaded to ArduPilot at startup through a
connection-aware SITL-only MAVLink transaction. They give the bridge a real
mission to read, but loading them neither arms the vehicle nor begins AUTO mode.
This GCS intentionally has no arm/mode/mission write capability. A stationary
marker is therefore expected at startup and is not a telemetry failure.

If movement is needed for a separate map/track exercise, control it through an
explicit MAVProxy or another authorized GCS workflow—not through this project
bridge. Keep that flight-control exercise separate from the read-only mission
acceptance result.

### Frame type is physics, not just a label

`sim_vehicle.py` chooses a default frame if `-f` is omitted: `quad` for Copter
and `plane` for ArduPlane. ArduPilot documents that the frame selects both
parameters and the physics model. If this scenario later targets a QuadPlane,
heli, VTOL, or a specific airframe, add an explicit `-f` and matching parameter
file; do not infer its behavior from the default Plane process.

### SITL state and repeatability

SITL can persist changed parameters in `eeprom.bin`; `-w` resets it to defaults.
The project containers do not mount a SITL state directory, so a fresh container
starts from its configured defaults. If persistent state is introduced later,
the acceptance command must add an explicit wipe/reset policy or results will
depend on a prior run.

### Multiple GCS outputs are normal

`sim_vehicle.py` starts MAVProxy by default. MAVProxy is the forwarding hop in
this setup, and ArduPilot supports forwarding to multiple GCS endpoints. Do not
point another MAVLink sender at bridge port 14550 during acceptance: the bridge
will correctly report duplicate transmitters when one `sysId:compId` arrives
from multiple sources.

### Useful evidence when a run fails

Capture: the failing service's Compose logs, bridge decode-error count, the two
system IDs seen in the roster, mission status/reason for both nodes, and the
recording filename. This is enough to distinguish a simulator startup issue,
UDP routing issue, MAVLink decoder issue, and browser presentation issue.
