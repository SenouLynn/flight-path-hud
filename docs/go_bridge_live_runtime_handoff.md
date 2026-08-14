# Go MAVLink bridge Phase E — live read-only runtime handoff

## Assignment

Implement an **opt-in** live Go runtime around the completed offline Go bridge
core. The runtime must accept MAVLink over UDP, publish protocol-v0 JSON over a
browser-compatible WebSocket, support only exact-target parameter read/list
requests, write bounded JSONL recordings, replay them passively, publish fresh
flight state, and shut down cleanly.

Node remains the default bridge and rollback path. This phase does not cut over
`pnpm gcs:mock`, port mission/command/write families, add configuration UI, add
gRPC/Protobuf/OpenAPI, or claim Pi/SITL acceptance.

Create a fresh branch and linked worktree from the `main` commit containing this
handoff, and record that resolved base hash before editing. Work in small commits
aligned to the phases below. Do not edit from another worktree.

## Why this phase exists

Phases A–D established language-neutral contracts and equivalent Node/Go folds,
but the Go module still has no sockets or process lifecycle. Phase E proves that
the same folds can run behind bounded live adapters without breaking existing
browser consumers or introducing vehicle-write capability. One additive
capability advertisement is authorized so unsupported controls fail closed.
Phase F remains responsible
for mixed ArduCopter/ArduPlane SITL and Raspberry Pi 5 acceptance.

## Authority and conflict policy

Use this order when evidence disagrees:

1. strict schemas and language-neutral fixtures under `contracts/`;
2. accepted ADRs and roadmap decisions;
3. observable Node behavior covered by tests;
4. undocumented Node implementation details;
5. this handoff.

Do not silently choose between conflicting authorities. Append a numbered item
to `docs/go_bridge_open_questions.md` containing the conflict, evidence,
options, recommendation, and blocked phase. Add the smallest failing
language-neutral fixture or test that demonstrates it, commit the evidence, and
stop only the affected work.

An audit that finds no new question must add a dated `none found` entry to the
Phase E audit. Absence of a new question is not itself evidence that the audit
happened.

## Required reading

Read these files completely before editing:

- `docs/go_bridge_port_handoff.md`
- `docs/go_bridge_open_questions.md`
- `docs/go_bridge_capability_matrix.md`
- `docs/vehicle_configuration_roadmap.md`
- `docs/gcs_architecture_precedents.md`
- `docs/gcs_live_runtime_precedents.md`
- `docs/decisions.md`, especially ADR-0022, ADR-0023, ADR-0027, and ADR-0030
- every schema in `contracts/wire/`
- `contracts/mavlink/parameter-command-vectors.json`
- `contracts/semantics/parameter-list-trace.json`
- `apps/mavlink-bridge/src/index.js`
- `apps/mavlink-bridge/src/udpIngress.js`
- `apps/mavlink-bridge/src/replayIngress.js`
- `apps/mavlink-bridge/src/recording.js`
- `apps/mavlink-bridge/src/flightStateTracker.js`
- all files in `apps/mavlink-bridge-go/`
- root and bridge package scripts and README files

Verify every path and script against the repository. Update stale references in
this document before implementation; do not invent missing files.

## Scope

### Included

- a Go executable under `apps/mavlink-bridge-go/cmd/bridge/`;
- strict configuration parsing and startup validation;
- IPv4 UDP ingress and exact-target reply routing;
- the eight existing raw protocol-v0 telemetry families and stream health;
- `linkMode` and fresh `flightState` output;
- an additive `linkMode.capabilities` advertisement and the smallest gcs-core/UI
  gate changes needed to disable unsupported mission/write/guided controls;
- inbound `requestParameter` and `requestParameterList` only;
- existing Phase D parameter transaction folds and exact MAVLink request bytes;
- bounded late-client snapshots for the frame families this runtime owns;
- bounded per-client WebSocket queues and connection count;
- JSONL raw/lifecycle recording with startup retention;
- passive paced replay with optional looping and no transmit surface;
- deterministic orchestration tests, process tests, race tests, and cross-builds;
- additive root scripts such as `start:bridge-go`, `replay:bridge-go`, and
  `gcs:mock:go`; and
- operator documentation for macOS and Linux, including Pi-oriented paths.

### Excluded

- changing `gcs:mock` or any default runtime;
- accepting mission read/upload, message request/interval, parameter writes,
  generic commands, mode changes, arm/disarm, Guided operations, or arbitrary
  outbound MAVLink;
- serial, TCP, IPv6, TLS, authentication, cloud exposure, or remote-origin use;
- vehicle-configuration workspace work beyond capability-aware safety gating;
- SITL or Raspberry Pi acceptance claims;
- protocol v1, gRPC, Protobuf, OpenAPI generation, or WASM;
- signed MAVLink v2 support; and
- deleting or simplifying the Node bridge.

Unsupported client command types must emit no UDP bytes. They may be ignored or
receive a stable protocol-v0 failure only if that behavior is first specified by
a fixture and accepted by the current GCS. Never route them through a generic
send API.

The countable inbound set for Phase E is exactly `requestParameter` and
`requestParameterList`. Malformed JSON, unknown types, and the other eleven
currently known command types are ignored and emit no UDP bytes, matching Node's
non-throwing boundary while deliberately omitting its disabled-family failure
frames. Record this as a temporary Phase E divergence.

Extend `linkMode` with a strict `capabilities` array whose values come from a
closed schema enum. Go advertises only `telemetry`, `parameterRead`, and
`parameterList`. Node advertises every family its current runtime actually
exposes. Legacy frames with no array remain valid for recordings/third-party
producers, but consumers must treat absence as legacy behavior and an explicit
array as authoritative. Update mission and write/guided UI gates so a capability
not advertised is visibly disabled with a reason; do not leave controls enabled
to send requests the bridge will ignore. ADR-0027 mission read remains Phase G.

## Fixed runtime decisions

These decisions resolve the deferrals in the first handoff. They are local
safety and portability choices, not claims that QGroundControl or Mission
Planner use identical numeric limits. Phase E0 must first validate the model
against those products as described below. If primary-source precedent or
repository evidence proves a value incompatible, report an open question rather
than quietly widening or removing the bound.

### Precedent-derived architecture

The implementation should internalize the common shape proven by mature GCSs:

- links are transport capabilities, not vehicle identity;
- state and transactions belong to an exact per-vehicle/per-component scope;
- parameter acquisition is a lifecycle with progress, missing-item recovery,
  retries, completion, and explicit failure rather than a bag of values;
- live reception and replay enter through the same domain boundary;
- connection loss invalidates route capability without silently reassigning a
  transaction to another sender;
- logging is operational evidence, not merely a debug print stream; and
- firmware/vehicle differences belong in explicit policy layers above generic
  MAVLink framing.

Do not copy QGC's Qt object model or Mission Planner's global communication
objects. Preserve this repository's stricter contracts, single-owner runtime,
bounded state, exact-target routes, and language-independent evidence.

Before finalizing adapters, upgrade the planning draft at
`docs/gcs_live_runtime_precedents.md` into verified evidence from current primary
sources in the official QGroundControl and Mission Planner
repositories and documentation. The comparison matrix must cover:

1. link versus vehicle identity and multi-link/multi-vehicle routing;
2. heartbeat/autopilot discovery and component selection;
3. GCS system/component identity;
4. parameter download start, progress, missing-index recovery, retries,
   completion, cache invalidation, reconnect, and firmware change;
5. MAVLink signing and the trust boundary for read requests;
6. inbound/outbound message logging and replay transmit-freedom;
7. threading, event ordering, queueing, and slow-consumer behavior where source
   makes it observable; and
8. shutdown, reconnect, and link failover behavior.

For each row record QGC behavior, Mission Planner behavior, the adopted local
rule, deliberate deviations, exact upstream URL and source symbol/path, and the
upstream revision or access date. Mark inference as inference. Product precedent
informs the model; MAVLink/ArduPilot protocol documentation, local contracts,
and observed SITL remain authoritative for exact bytes and safety behavior.

### Dependency and network exposure

- Pin `github.com/coder/websocket` to the reviewed current stable version. At
  handoff drafting time, the maintained package was `v1.8.15`; verify the exact
  version and checksum when adding it.
- Use `net/http` and `net.UDPConn`; do not add a framework or dependency
  injection container.
- WebSocket binds to `127.0.0.1:8080` by default, path `/telemetry`. UDP remains
  `0.0.0.0:14550` by default. Environment variables retain the existing Node
  names where semantics match.
- Production/live UDP accepts MAVLink frames only. Strict JSON-envelope UDP is a
  mock compatibility adapter enabled only by
  `MAVLINK_BRIDGE_ALLOW_JSON_UDP=1`; `gcs:mock:go` sets it explicitly. A JSON
  envelope must not be able to claim a route in the default live profile.
- Cross-origin acceptance must be explicit and limited to local development
  origins used by this repository. Do not use an unconditional origin bypass.
- Default maximum WebSocket clients: 16. Make it configurable within the range
  1–128 and reject invalid startup values.

Disable WebSocket compression so the wire read limit and memory accounting are
the same quantity. Accept these exact default browser origins:
`http://localhost:5173`, `http://localhost:5174`,
`http://127.0.0.1:5173`, and `http://127.0.0.1:5174`. A missing `Origin` is
accepted only when the TCP peer is loopback. An additive comma-separated origin
allowlist may contain exact `http`/`https` origins only—no wildcard, `null`, path,
userinfo, or invalid URL.

### Configuration contract

Parse configuration before opening any file or socket. Unknown environment
variables are outside the process's knowledge, but every recognized variable
must reject empty, malformed, non-finite, fractional where integral, or
out-of-range values with a nonzero startup exit. Durations are integer
milliseconds and sizes are integer bytes unless named otherwise.

| Environment variable | Default | Valid values |
| --- | --- | --- |
| `MAVLINK_BRIDGE_UDP_HOST` | `0.0.0.0` | IPv4 literal |
| `MAVLINK_BRIDGE_UDP_PORT` | `14550` | 1–65535 |
| `MAVLINK_BRIDGE_WS_HOST` | `127.0.0.1` | loopback IPv4 only in Phase E |
| `MAVLINK_BRIDGE_WS_PORT` | `8080` | 1–65535 |
| `MAVLINK_BRIDGE_WS_PATH` | `/telemetry` | one absolute path, 1–128 printable ASCII bytes, no query/fragment |
| `MAVLINK_BRIDGE_WS_ALLOWED_ORIGINS` | four origins above | comma-separated exact `http`/`https` origins, at most 32 entries/4 KiB |
| `MAVLINK_BRIDGE_WS_MAX_CLIENTS` | `16` | 1–128 |
| `MAVLINK_BRIDGE_WS_READ_MAX_BYTES` | `65536` | 1024–65536 |
| `MAVLINK_BRIDGE_WS_OUTBOUND_MAX_BYTES` | `16777216` | 1048576–16777216; startup proof must cover the selected value |
| `MAVLINK_BRIDGE_WS_QUEUE_MAX_BYTES` | `41943040` | 33558528–67108864 and at least snapshot budget + outbound max + 4096 bytes |
| `MAVLINK_BRIDGE_WS_QUEUE_MAX_MESSAGES` | `256` | 16–1024 |
| `MAVLINK_BRIDGE_WS_WRITE_TIMEOUT_MS` | `5000` | 100–30000 |
| `MAVLINK_BRIDGE_WS_PING_INTERVAL_MS` | `20000` | 1000–60000 |
| `MAVLINK_BRIDGE_OWNER_QUEUE_MAX_BYTES` | `8388608` | 1048576–67108864 |
| `MAVLINK_BRIDGE_OWNER_QUEUE_MAX_EVENTS` | `4096` | 64–65536 |
| `MAVLINK_BRIDGE_SYSTEM_TTL_MS` | `10000` | 1000–300000 |
| `MAVLINK_BRIDGE_GCS_SYSTEM_ID` | `255` | 1–255 |
| `MAVLINK_BRIDGE_GCS_COMPONENT_ID` | `190` | 1–255 |
| `MAVLINK_BRIDGE_ALLOW_JSON_UDP` | `0` | exactly `0` or `1` |
| `MAVLINK_BRIDGE_RECORD` | `1` | exactly `0` or `1` |
| `MAVLINK_BRIDGE_RECORD_DIR` | `recordings` | nonempty path, resolved/logged absolutely |
| `MAVLINK_BRIDGE_RECORD_FILE` | generated session name | nonempty `.jsonl` path beneath the resolved record directory |
| `MAVLINK_BRIDGE_RECORD_MAX_MB` | `256` | finite 1–4096 decimal MB |
| `MAVLINK_BRIDGE_RECORD_RETAIN_DAYS` | `7` | finite 0–3650; zero expires all prior recordings |
| `MAVLINK_BRIDGE_RECORD_TOTAL_MAX_MB` | `128` | finite 0–16384 decimal MB |
| `MAVLINK_BRIDGE_REPLAY_FILE` | unset | readable regular `.jsonl` file |
| `MAVLINK_BRIDGE_REPLAY_SPEED` | `1` | finite >0 and <=100 |
| `MAVLINK_BRIDGE_REPLAY_LOOP` | `0` | exactly `0` or `1` |
| `MAVLINK_BRIDGE_REPLAY_WAIT_FOR_CLIENT` | `1` | exactly `0` or `1` |
| `MAVLINK_BRIDGE_SHUTDOWN_TIMEOUT_MS` | `5000` | 100–30000 |

The recorder queue (4 MiB/4,096 entries), 65,535-byte UDP buffer, 256-target
cap, eight-active-transaction cap, 16 MiB active/snapshot budgets, 100 ms UDP
write deadline, 100 ms transaction tick, one-second roster tick, and transaction
retry constants below are fixed Phase E policy rather than additional
environment surface. Replay mode disables recording and rejects simultaneous
live-only configuration that would imply opening UDP; an explicit record file
outside its resolved record directory is invalid.

### Message and memory bounds

- Allocate a 65,535-byte UDP read buffer. Copy exactly `n` bytes before handing
  a datagram to another goroutine or retaining it. Count kernel-reported receive
  errors and application decode/drop outcomes separately.
- Phase E accepts only the two small read-only parameter command shapes. Set a
  64 KiB WebSocket read limit and require their request IDs to be 1–128 printable
  ASCII bytes. Update the corresponding client-command and parameter-lifecycle
  schema branches, Node validators, and valid/invalid fixtures so this is a
  shared contract correction rather than a Go-only rule.
- Set the maximum serialized outbound WebSocket message to 16 MiB. Before
  implementation, prove from schemas and a deterministic worst-case
  parameter-list generator that every Phase E-owned valid frame fits. Check in
  the generator, expected encoded byte count/hash, and compact limit/limit+1
  cases rather than a multi-megabyte generated fixture. If the proof fails,
  tighten a domain
  bound with shared contract evidence or report an open question; never truncate
  JSON or split one protocol-v0 frame ad hoc.
- Each client gets one writer goroutine and an immutable-message queue bounded by
  both 256 entries and 40 MiB of logical payload bytes. Immutable payload bytes
  may be shared across clients, but each queue is charged the full logical size.
  Close a client with status 1013 when either bound would be exceeded. Never
  block the state owner on a slow client.
- Permit at most 256 live `(sysId, compId)` targets, eight active parameter
  transactions total, and one active parameter list per exact target. Reject new
  work deterministically when a limit is reached.
- Bound active parameter-list state and all late-client state by measured bytes,
  not only object counts. Each has a fixed 16 MiB Phase E budget. A limit failure must produce a
  terminal lifecycle frame, release transaction state, and send no further retry.

### Snapshot policy

- The state owner holds snapshots; WebSocket clients never query mutable folds
  concurrently.
- Snapshot bytes are the exact lengths of canonical `json.Marshal` payloads that
  would be enqueued, summed without WebSocket framing overhead. Reserve state in
  this order: fresh flight states, active parameter lifecycles, then terminal
  parameter results. Refuse a new transaction with a terminal resource-limit
  frame if its active snapshot/state cannot fit; never evict flight or active
  state to admit terminal history.
- Retain the newest fresh flight state per exact target.
- Retain the newest parameter-read result per exact target plus selector and the
  newest parameter-list result per exact target, subject to the global 16 MiB
  snapshot budget.
- Pending states are retained while active. Terminal states use deterministic
  least-recently-updated eviction with `(updatedAtMs, type, sysId, compId,
  requestId)` as the total-order tie breaker.
- `requestId` is unique across active and retained Phase E parameter frames. A
  duplicate fails without transmission. Reuse is allowed only after the prior
  result has been evicted; there is no unbounded process-lifetime tombstone.
- Never evict active state to admit terminal state. If one terminal frame alone
  exceeds the budget, publish it to currently healthy clients if it fits their
  queue but do not cache it.
- A new client receives `linkMode` first, then snapshot frames in deterministic
  `(type, sysId, compId, requestId-or-empty-string)` order. Snapshot enqueue
  obeys the same queue
  limits as live publication; there is no privileged unbounded catch-up path.
- Enforce at startup and in boundary tests:
  `clientQueueBytes >= snapshotBytes + maxOutboundMessageBytes + 4096`. This
  guarantees room for mandatory `linkMode`, the largest permitted snapshot, and
  one concurrent maximum live frame. Connection registration and the complete
  `linkMode`/snapshot enqueue happen as one owner event; live publication for the
  client starts afterward.
- Flight state is fresh through exactly 3,000 ms and stale afterward. Reclaim
  stale tracker storage no later than the 10-second system expiry. Protocol v0
  has no removal frame, so already-connected browsers may display the last state
  until another UI event clears it; document this existing UI debt and do not
  invent a Go-only wire frame.

### Identity and time

- `MAVLINK_BRIDGE_GCS_SYSTEM_ID` and `MAVLINK_BRIDGE_GCS_COMPONENT_ID` default to
  `255` and `190`. Validate each as a nonzero uint8 at startup and pass them
  explicitly to request encoders.
- Use wall-clock Unix milliseconds only for public/recorded timestamps.
- Use Go monotonic time for live TTLs, retry deadlines, queue/write deadlines,
  shutdown deadlines, and replay waits. Tests receive an injected clock/timer.
- Replay dispatch supplies recorded `atMs` to pure folds for deterministic
  output. Live roster/route freshness uses current monotonic time. Loop restart
  resets pacing to the recording origin and must not accumulate drift from the
  preceding loop.

### Parameter-list repair policy

Phase E intentionally strengthens the Phase D whole-list retry using the shared
QGC/Mission Planner transaction shape. Pin these initial constants in the
language-neutral semantic trace and use them identically in Node and Go:

- 3,000 ms quiet interval;
- at most two `PARAM_REQUEST_LIST` retries, and only while no valid
  `PARAM_VALUE` has established useful progress/count;
- after a count is known, request missing indexes in ascending batches of at
  most 10 `PARAM_REQUEST_READ` messages per quiet interval;
- at most three repair requests per missing index;
- 60,000 ms total transaction deadline from the first list request; and
- one active list per exact target and eight active parameter transactions total.

Any valid exact-target progress resets the quiet interval but not the total
deadline. A count change, route/epoch loss, resource limit, exhausted index, or
total deadline produces a terminal failure. Add required, sorted
`missingIndices` to the strict parameter-list lifecycle schema (`[]` before a
count is known and on completion), update gcs-core plus Node/Go consumers, and
add valid/invalid fixtures. Partial staged values remain absent from
`parameters`; `receivedCount`, `expectedCount`, `latest`, and `missingIndices`
make incompleteness explicit. This is an authorized additive protocol-v0 change,
not a claim of byte-for-byte Node runtime parity. Phase F may tune constants only
through a new ADR and updated traces based on SITL evidence.

### Ownership and event order

- Exactly one state-owner event loop mutates core, routes, transactions, flight
  state, and snapshot state.
- UDP, WebSocket readers, recorder completion, ticks, and OS signals submit typed
  events to that owner. They do not call folds directly.
- The owner mailbox is bounded by both configured event count and logical bytes.
  Charge UDP/WS events their copied payload length and charge control events 256
  bytes. When full: drop a UDP datagram and increment dedicated datagram/byte
  overload counters; close the submitting WebSocket client with 1013 and emit no
  UDP; reject a new-client registration; and coalesce each tick kind to at most
  one pending event. Signal cancellation bypasses the mailbox through
  `context.Context`. Recorder completions use a bounded one-result handoff and
  may not recursively enqueue work.
- Within one datagram: record/copy raw bytes, normalize in wire order, remember
  each decoded exact target route, update flight state, fold parameter responses,
  then apply public publish policy. Preserve output order.
- The 100 ms transaction tick and 1 s roster/route tick remain distinct logical
  schedules. Coalescing delayed ticks is allowed only if every fold sees one
  explicit current time and retry counts cannot increase merely because the
  process was paused.
- Keep three concepts separate. The existing public core roster continues to
  observe every supported envelope so Phase A–D conformance is unchanged. A
  route candidate exists only after a valid accepted MAVLink envelope (or an
  explicitly enabled mock JSON envelope). A read-authorized vehicle epoch starts
  only on HEARTBEAT from `sysId` 1–255, component 1, a system ID different from
  the configured GCS, `vehicleType != MAV_TYPE_GCS (6)`, and
  `autopilotType != MAV_AUTOPILOT_INVALID (8)`. Pre-heartbeat telemetry still
  publishes, but no read request can transmit.
- UDP reply routing is exact `(sysId, compId)` and additionally requires a fresh
  authorized epoch for the system plus a fresh route observed for that exact
  component. Never fall back to the most recent sender or component 1.
- The incumbent route is fresh for `SYSTEM_TTL_MS` from its own accepted traffic.
  Traffic from a competing endpoint reports a source conflict but does not
  refresh or replace the incumbent and is not retained as a pending route. At or
  beyond expiry, owner ordering is: expire route and authorized epoch if due,
  fail their active transactions, then allow the current accepted datagram to
  establish a new route/epoch. Pin boundary, conflict, and migration behavior in
  a language-neutral trace. Record this stronger rule as an explicit divergence
  from Node's immediate last-source replacement.
- The authorized epoch is bound to the incumbent autopilot endpoint and refreshed
  only by a qualifying heartbeat from that endpoint. A competing heartbeat does
  not refresh it. Epoch expiry fails reads even if non-heartbeat telemetry keeps
  a component route fresh.
- The owner performs each tiny UDP parameter-request write synchronously with a
  100 ms write deadline. A timeout/error produces a terminal failure, increments
  outbound error counters, and never blocks later owner work beyond that
  deadline. Every request/retry attempt is recorded with `sent` or `failed`
  outcome after the write result and before its pending/failure lifecycle frame.

### Recording and replay

- Add `contracts/recording/bridge-recording-entry.schema.json` with four strict
  branches: legacy inbound raw, directional inbound raw, directional outbound
  raw, and lifecycle event. Every branch requires finite nonnegative `tMs` and
  finite positive Unix-ms `atMs`; raw branches require valid `base64`.
  Directional inbound requires `direction:"inbound"` and a 1–128 printable ASCII
  `source` label. Directional outbound requires `direction:"outbound"`,
  nonbroadcast uint8 `targetSysId`/`targetCompId`, `outcome:"sent"|"failed"`,
  and nullable printable `reason` of at most 256 bytes. Lifecycle requires
  `event` matching a strict protocol-v0 lifecycle schema. No branch allows extra
  properties. Legacy raw entries without direction mean inbound.
- Record inbound datagrams before decode and record exact outbound parameter-read
  request bytes with their target. Replay decodes inbound entries only; outbound
  entries are passive audit evidence and can never reach a sender.
- Update Node `readRecording` to recognize direction and never return outbound
  bytes as decoder input. Check in cross-runtime fixtures proving legacy replay,
  Go directional replay in Node, raw/event order, every retry, and sent/failed
  outbound attempts.
- Recording is enabled by default only with the Node-compatible caps: 256 MB per
  run, seven days, and 128 MB retained from prior runs. Values are startup
  configurable and strictly validated.
- The recorder owns one queue bounded by both 4,096 entries and 4 MiB. Compute
  byte limits from the exact encoded JSONL line including newline. On queue
  overflow or per-run cap, stop accepting new recording entries, emit one loud
  diagnostic, preserve the valid prefix, and keep telemetry running. Do not
  silently drop arbitrary middle entries.
- Write one complete encoded line directly to `os.File`, tracking the last
  committed offset. On a short/error write, truncate back to that offset before
  stopping the recorder; failure to restore the prefix is fatal and the file is
  renamed with a `.partial` suffix that replay rejects. Do not fsync each line;
  flush and `Sync` once on clean shutdown and report either failure.
- Startup pruning touches only regular `.jsonl` files in the resolved recording
  directory, never follows symlinks, never deletes the selected active file, and
  logs name, byte count, and age/size reason for every deletion.
- Replay never opens UDP, never constructs a sender, and never records its own
  output. Malformed JSONL, invalid base64, non-finite/negative timing, or time
  regression fails startup with a nonzero exit rather than partially replaying.
- Validate and replay recordings with bounded-memory streaming passes; never
  load a potentially 256 MB recording into a slice of decoded entries.
- Replay speed must be finite and greater than zero. Cancellation and shutdown
  must interrupt a long wait promptly. Live and replay ingress are mutually
  exclusive. By default pacing begins only after the first accepted WebSocket
  client registration; tests/headless tools may set the documented wait flag to
  zero. A finite replay remains online after its final entry so the browser can
  inspect retained terminal snapshots, and exits only on cancellation. Loop mode
  resets core, flight, transaction, and snapshot state at the loop boundary,
  emits a fresh `linkMode` to connected clients, then restarts pacing from the
  recording origin; clients and process-level overload/error counters persist.
- During replay, envelope and flight-state public timestamps use recorded
  `atMs`; hidden freshness/deadline ages use monotonic time since dispatch.
  Snapshot LRU uses an owner event ordinal as the final tie-breaker so a wall
  clock jump or repeated recording timestamp cannot make eviction ambiguous.

### Shutdown

Shutdown is idempotent and ordered:

1. cancel signal context and stop accepting HTTP/WebSocket clients;
2. stop UDP/replay ingress so no new events enter;
3. stop logical tick producers;
4. drain already accepted owner events within a fixed deadline;
5. close client queues and complete/close WebSockets;
6. flush and close the recorder;
7. wait for owned goroutines and return from `main`.

Do not call `os.Exit` below `main`; deferred cleanup must run. A second signal may
force cancellation but tests must prove ordinary SIGINT/SIGTERM leaves no stuck
goroutine and a parse/startup failure does not leak a partially opened resource.

## Node behaviors that are reference evidence, not automatic parity

- `index.js:24-56` defines environment names and recording/replay defaults.
- `index.js:62-66` chooses exactly one ingress adapter.
- `index.js:149-157` broadcasts synchronously without backpressure. Go must use
  the bounded policy above; copying this is forbidden.
- `index.js:159-164` couples roster and route expiry on the one-second tick.
- `index.js:174-225` defines raw recording, normalization, route memory,
  flight-state folding, parameter routing, and raw/routed publication order.
- `index.js:261-323` sends `linkMode`, then late-client snapshots, then accepts
  unauthenticated commands. Go supports only the Phase E subset.
- `index.js:326-340` uses a 100 ms transaction tick.
- `index.js:342-352` has incomplete shutdown waiting/idempotence. Go follows the
  stronger contract above.
- `udpIngress.js:15-78` shows source identity and exact-route ownership.
- `recording.js:11-63` defines valid-prefix recording and stop-at-cap behavior;
  `recording.js:77-118` defines age then newest-first size retention.
- `replayIngress.js:23-66` defines pacing and loop reset, but Go must additionally
  reject invalid timing and make long waits cancellable.
- `flightStateTracker.js:7-31` defines three-second freshness and deterministic
  target ordering.

Re-check line numbers after rebasing; semantic references matter more than stale
line numbers.

## Work phases and gates

### E0 — decision evidence and process shell

1. Re-verify and, where needed, update the checked-in primary-source QGC/Mission
   Planner comparison matrix; identify which local decisions it supports or
   contradicts.
2. Record the fixed decisions above in an ADR, including dependency provenance,
   threat boundary, resource accounting, and explicit Node divergences.
3. Add schema/fixture bounds for the two supported request IDs.
4. Add `docs/go_bridge_live_capability_matrix.md` with one row per externally
   observable behavior named in this handoff, not one row per unit test.
5. Add strict configuration parsing tests, an inert `cmd/bridge` shell, and root
   build/test scripts. No socket may bind in a unit test.
6. Add a dated Phase E open-question audit.

Gate: contracts validate, Node consumers pass, configuration errors are
deterministic, Go tests/race tests pass, and the shell cannot transmit.

### E1 — orchestration, flight state, and bounded snapshots

1. Amend the language-neutral parameter-list trace for bounded missing-index
   repair based on the shared QGC/Mission Planner lifecycle: whole-list retry is
   permitted only before a useful count/progress exists; afterward use bounded
   exact-index requests. Update Node and Go folds to agree before live wiring.
2. Implement the single-owner runtime state machine with injected ports.
3. Add a Go flight-state fold matching schema-visible Node behavior under an
   explicit clock.
4. Add bounded snapshot accounting and deterministic eviction.
5. Add table/trace tests for event ordering, target limit, active transaction
   limit, oversized results, late clients, and TTL boundaries.

Gate: all tests are socket-free, deterministic, race-clean, and demonstrate that
only the owner mutates state.

### E2 — UDP and read-only request path

1. Add UDP ingress with explicit byte ownership and exact endpoint routes.
2. Wire `requestParameter` and `requestParameterList` through Phase D folds.
3. Prove every other client command and malformed input emits zero UDP bytes.
4. Add loopback tests for two sources sharing/differing system IDs, route expiry,
   source conflict, heartbeat authorization, public-roster/pre-authorization
   telemetry, incumbent retention, deterministic migration, reconnect, truncated
   datagrams, and shutdown during receive.

Gate: exact-target reads work over loopback; peer/cross-target responses cannot
advance a transaction; route loss fails closed; `go test -race` passes.

### E3 — WebSocket protocol v0 and backpressure

1. Add local HTTP/WebSocket serving with path, origin, connection, and read
   limits.
2. Parse exactly one JSON object and enforce the strict client-command branch for
   the two supported request types, including `additionalProperties:false` and
   printable bounded request IDs. Apply the same correction to Node validators.
   Malformed/unknown/unsupported messages are ignored, counted by category, and
   emit zero UDP bytes.
3. Publish capability-aware `linkMode`, raw telemetry, health, flight state, and
   parameter lifecycle frames using existing JSON names and null/omission
   behavior.
4. Implement one writer per client, bounded queues, deterministic snapshots,
   ping/write deadlines, and slow-client closure.
5. Add an in-process browser-protocol client test and a Node-versus-Go normalized
   output comparison that excludes intentionally different resource failures.

Gate: after the authorized capability-gate change, the current GCS consumes Go
mock telemetry and visibly disables mission/write/guided controls with an
unsupported-by-bridge reason; no dead enabled control remains. A slow client
cannot stall another client or the owner; max clients and oversized input are
rejected predictably; all emitted frames validate against protocol v0.

### E4 — recording, replay, and lifecycle

1. Add the bounded JSONL recorder and safe startup pruning.
2. Add strict paced/looping replay through the same owner and publication path.
3. Add SIGINT/SIGTERM and partial-startup cleanup tests.
4. Add a process harness using ephemeral UDP/HTTP ports and temporary recording
   directories. Never use the repository recording directory in tests.
5. Add opt-in operator scripts and update READMEs. Keep Node defaults unchanged.

Gate: live raw plus parameter lifecycle events produce a valid recording;
passive Go replay emits equivalent protocol frames and zero UDP bytes; finite
replay reaches completed idle and later shuts down on signal; loop replay resets
and cancels; cap/retention/shutdown evidence passes.

### E5 — Phase E acceptance and hard stop

Run the mock fleet with the current React GCS against the opt-in Go runtime and
record the commands, URLs, expected UI observations (including disabled
unsupported controls), and resource/drop metrics. Add the results to the live
capability matrix. Cross-build macOS native, Linux amd64, and Linux arm64.

Then stop. Do not begin mixed-SITL/Pi acceptance (Phase F), additional outbound
families (Phase G), runtime cutover (Phase H), or vehicle-configuration UI.

## Required verification

Expose stable root scripts, then run at minimum:

```bash
pnpm test:bridge
pnpm test:gcs-core
pnpm test:hud-ui
python3 contracts/conformance/heading_vectors.py
pnpm test:bridge-go
pnpm build:bridge-go
pnpm conformance:bridge-go
pnpm test:bridge-go-live
git diff --check
git status --porcelain
```

Also run focused process tests with ephemeral ports, a slow-client test, and a
manual `gcs:mock:go` session. Report exact pass counts. If pnpm refuses a linked
worktree with `ERR_PNPM_UNSAFE_MODULES_DIR`, run the underlying checked-in
commands directly and report the substitution; do not reinstall over shared
dependencies merely to silence the guard.

## Stop conditions

Stop the affected phase and report an open question when:

- a strict contract and observable Node/GCS behavior conflict;
- the 16 MiB outbound bound cannot contain a valid Phase E frame;
- a needed contract tightening would affect families outside the authorized two
  request types;
- exact-target route ownership or replay transmit-freedom would weaken;
- a second state owner or unbounded queue/cache appears necessary;
- WebSocket origin requirements cannot cover the repository's local clients
  without an unconditional bypass;
- a new dependency beyond the one reviewed WebSocket module is needed;
- tests require fixed ports, repository recording writes, real vehicles, or
  network access outside loopback;
- completing a claim requires Phase F SITL/Pi evidence; or
- implementation would alter the default Node runtime.

Do not file an open question merely because implementation is difficult. Use it
only for a genuine authority or product decision this handoff does not resolve.

## Completion report

The final report must include:

- base/head commits, branch, and worktree;
- commits by phase;
- dependency and checksum added;
- capability matrix with complete/partial/unstarted rows;
- all configured defaults and enforced ranges;
- exact test commands and pass counts;
- mock/GCS validation observations;
- known Node divergences and why each is authorized;
- unresolved and deliberately deferred evidence, especially the live SITL
  parameter-list capture and Pi 5 measurements;
- tests not run; and
- confirmation that Node remains default and Phases F–H/UI were not started.
