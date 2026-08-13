# MAVLink Bridge

UDP → WebSocket bridge for GCS receive-only development.

## What it does

- Listens for UDP datagrams: JSON telemetry envelopes, or binary MAVLink v1/v2 frames.
- Validates frame checksums (X.25 CRC + per-message `CRC_EXTRA`) and normalizes
  the payload into a canonical `TelemetrySample`.
- Broadcasts envelopes to WebSocket clients at `/telemetry`.
- Emits stream health in every outbound frame: packet rate, decode/drop counters,
  per-message rates, and the roster of systems seen.
- Records the session to disk so it can be replayed deterministically.

The core is transport-agnostic ([bridgeCore.js](src/bridgeCore.js)): UDP and
replay are interchangeable ingress adapters (ADR-0022).

## Run

From the repository root:

```bash
npm run start:bridge     # bridge (records by default)
npm run sample:bridge    # synthetic vehicle, if you have no real one
```

Defaults: UDP `0.0.0.0:14550`, WebSocket `ws://localhost:8080/telemetry`.

Only one sample sender may run at a time — it binds a fixed source port as a lock
and refuses to start twice. Two senders both claim `sysId 1`, and the client
correctly merges them into a single aircraft with contradictory telemetry, which
shows up as a sawtooth ground track rather than an obvious error.

## Mixed ArduPilot SITL acceptance

The repository includes a reproducible **ArduCopter + ArduPlane** scenario for
validating the bridge against real binary MAVLink v2, rather than the JSON mock:

```bash
npm run sitl-test:up
# separate terminal
npm run dev --workspace @flight-path-hud/gcs
```

`sitl-test:up` builds the pinned ArduPilot 4.6.2 image and starts the bridge plus
Copter (`1:1`) and Plane (`2:1`). Open the GCS at the Vite URL and retain its
default `ws://localhost:8080/telemetry` link. Both nodes must be live and moving.
Their seeded missions intentionally have different waypoint counts; click **Load
mission** for each row in either order and verify each route belongs to the
selected system, not the other vehicle.

Stop one service (for example `docker compose -f apps/mavlink-bridge/sitl/compose.yml
stop plane`): it should become stale and leave the roster while Copter remains
live. Restart it with `start plane` and verify recovery without reloading the
browser. The bridge records the run; use `npm run sitl-test:down`, then replay its new
recording through `npm run replay:bridge` and verify the same two-node roster and
mission overlays. `npm run sitl-test:logs` follows Compose logs.

This validates one simulated mixed-fleet scenario only; it is not a field or
arbitrary-fleet validation claim.

See [ArduPilot SITL Testing Nuances](../../docs/ardupilot_sitl_testing.md) for
the Compose topology, acceptance criteria, frame/mission behavior, and the
important distinction between loading a mission and making a simulator fly it.

### macOS and Apple Silicon: important constraint

The official SITL baseline is **Linux in Docker**, including on Apple Silicon
Macs. Docker Desktop runs the image as Linux/arm64; it is not an x86 emulator.
The image is built/downloaded on first use and cached locally by Docker. Do not
commit Docker images, ArduPilot checkouts, or build outputs to this repository.

ArduPilot's documented SITL setup targets Linux and Windows/WSL. Native macOS
SITL has community support and may be useful for experiments, but it is
best-effort only: it is not required, not part of this acceptance run, and not a
source of validation evidence. Reproduce any native-Mac-only behavior in this
Compose stack before changing the bridge or GCS. See ADR-0031.

## Recording

**Recording is on by default.** Each run writes
`recordings/session-<timestamp>.jsonl` — raw wire bytes plus normalized protocol
transaction events. Raw telemetry re-runs the parser during replay, while
request lifecycle events reconstruct without contacting a vehicle.

That default is only safe because retention is bounded. On startup the bridge
sweeps its recordings directory, and every run is capped:

| Variable | Default | Effect |
| --- | --- | --- |
| `MAVLINK_BRIDGE_RECORD` | `1` | `0` disables recording entirely |
| `MAVLINK_BRIDGE_RECORD_DIR` | `recordings` | Where sessions are written |
| `MAVLINK_BRIDGE_RECORD_FILE` | *(timestamped)* | Explicit path, overrides the above |
| `MAVLINK_BRIDGE_RECORD_MAX_MB` | `256` | Per-run cap (~17 h at ~15 MB/h) |
| `MAVLINK_BRIDGE_RECORD_RETAIN_DAYS` | `7` | Startup sweep drops older files |
| `MAVLINK_BRIDGE_RECORD_TOTAL_MAX_MB` | `128` | Startup sweep trims oldest-first past this |

Behaviour worth knowing:

- At the per-run cap the recorder **stops** rather than rotating. A recording
  truncated mid-stream is worse than one that plainly ends.
- Every pruned file is logged by name, size and reason. Silently deleting flight
  data would be worse than the disk usage.
- The sweep only touches `.jsonl` files, and never the file the current run is
  about to write.
- The sweep runs only at bridge startup, not continuously. Because it retains up
  to 128 MB from prior runs and excludes the active recording (capped at 256 MB),
  the directory can temporarily approach roughly 384 MB with the defaults.
- Recording is skipped while replaying — otherwise a replay would write a second
  copy of a recording you already have.

To run without writing anything:

```bash
MAVLINK_BRIDGE_RECORD=0 npm run start:bridge
```

## Replay

```bash
MAVLINK_BRIDGE_REPLAY_FILE=recordings/session-<timestamp>.jsonl npm run replay:bridge
```

Replays with the original inter-packet pacing and no vehicle, sender or UDP socket
attached. `MAVLINK_BRIDGE_REPLAY_SPEED` (default `1`) and
`MAVLINK_BRIDGE_REPLAY_LOOP=1` are available.

Captured `MISSION_COUNT`/`MISSION_ITEM_INT` response sequences are folded
passively into cached mission overlays during replay. This reconstruction emits
no MAVLink requests or acknowledgements; browser mission loading remains disabled
because there is no live vehicle to query.

Recorded command and parameter-read lifecycle events are also folded passively.
Replay never retries a request or emits outbound MAVLink.

The checked-in `mixed-sitl-motion-v2.jsonl` fixture is a minimized real-SITL
motion capture. To deliberately replace it from a reviewed successful run, use:

```bash
node apps/mavlink-bridge/src/curateMotionFixture.js \
  apps/mavlink-bridge/recordings/<session>.jsonl \
  apps/mavlink-bridge/test-fixtures/mixed-sitl-motion-v2.jsonl
```

The curator retains representative raw MAVLink rather than decoded envelopes,
rebases timestamps deterministically, and removes repetitive simulator traffic.
Run `npm run test:bridge` after curating; do not promote an arbitrary or failed
recording merely because it is newest.

Note: a recording is read fully into memory on replay, so it is bounded by the
per-run cap above.

## Other configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `MAVLINK_BRIDGE_UDP_HOST` / `_UDP_PORT` | `0.0.0.0` / `14550` | UDP ingress |
| `MAVLINK_BRIDGE_WS_PORT` / `_WS_PATH` | `8080` / `/telemetry` | WebSocket egress |
| `MAVLINK_BRIDGE_SYSTEM_TTL_MS` | `10000` | Drop a quiet system and its UDP return route from the roster |
| `MAVLINK_BRIDGE_SAMPLE_PORT` | `14549` | Sample sender's single-instance lock |

## Envelope shape

Outbound frames are JSON:

- `recvTimestampMs`, `sysId`, `compId`, `messageName`, `sequence` (uint8, wraps)
- `payload`: a `TelemetrySample` (`timestampMs` plus `attitude`, `vfrHud`,
  `globalPositionInt`, `gpsRawInt` as available)
- `health`: `packetRateHz`, `decodeErrorCount`, `droppedPacketCount`,
  `messageRates[]`, `systems[]`

Malformed datagrams are dropped and counted in `decodeErrorCount`.

### Read-only parameter request

WebSocket clients may request one parameter from an exact live target by name:

```json
{"type":"requestParameter","requestId":"parameter-1","sysId":1,"compId":1,"name":"SYSID_THISMAV"}
```

or by zero-based parameter index using `"index"` instead of `"name"`. The bridge
publishes `parameterRead` frames with `pending`, `complete`, or `failed` status.
Identical concurrent target/query pairs are rejected because MAVLink
`PARAM_VALUE` has no request ID and cannot correlate them unambiguously.

This is a read transaction only. It does not enable `PARAM_SET` or any browser
control authority.

Use `{"type":"requestParameterList","requestId":"parameters-1","sysId":1,"compId":1}`
to retrieve the full target-scoped parameter set. Progress frames contain counts
and the latest value; the completed frame contains the index-ordered set.

## Decoded messages

`HEARTBEAT` (0), `PARAM_VALUE` (22), `GPS_RAW_INT` (24), `ATTITUDE` (30),
`GLOBAL_POSITION_INT` (33), mission messages, `VFR_HUD` (74), `COMMAND_ACK` (77),
and `HOME_POSITION` (242). Others are skipped.

MAVLink orders payload fields **by size, not by XML declaration order** — the
decoders read size-sorted offsets. Getting that wrong produces plausible-looking
garbage rather than an error.

## Tests

```bash
npm run test:bridge
```

Covers the CRC against the published CRC-16/MCRF4XX check vector, frame decoding,
sequence wrapping, duplicate-transmitter detection, recording retention, and a
contract test asserting replay reproduces the live envelope stream exactly.
