# Go MAVLink bridge port — agent handoff

## Assignment

Build the first contract-compatible Go implementation of the MAVLink bridge in a
separate branch/worktree. The first branch is deliberately offline and read-only:
it proves framing, normalization, deterministic core behavior, recording input,
exact-target routes, and parameter read/list transactions.

It does **not** replace the Node runtime, open live sockets, write vehicle state,
or choose a new API/transport. Node remains a behavioral reference where the
portable contracts are silent.

The bridge is intended to run on ordinary general-purpose machines. Raspberry
Pi 5 Linux/arm64 is the mandatory edge acceptance target, not the only target.

## Authority and parity policy

When sources disagree, use this order:

1. Safety invariants: exact target, default-deny writes, replay transmit-freedom,
   bounded execution, and no implicit authority.
2. Language-neutral JSON Schemas, semantic traces, and MAVLink golden vectors.
3. Documented protocol-v0 compatibility behavior.
4. Authoritative MAVLink/ArduPilot definitions and observed SITL evidence.
5. Node behavior where the sources above are silent.

Do not preserve an apparent Node bug merely to claim parity. Add a minimal
language-neutral case, record the conflict as described in **Open questions and
stop conditions**, and stop that affected phase. Likewise, do not silently
"improve" externally visible behavior during the port.

Parity means semantic equality of contract fields and ordered lifecycle events
under a fixed injected clock. It does not mean reproducing event-loop drift,
filesystem implementation details, object-key order, or unbounded resource use.

## Before creating the worktree

Git worktrees do not inherit uncommitted files. The coordinating human/agent
must first:

1. Review and commit this handoff and its prerequisite roadmap/ADR changes.
2. Record that commit as `BASE_COMMIT` in the work item.
3. Confirm the main worktree has no uncommitted files the port depends on.

Example after choosing an explicit sibling directory:

```bash
git worktree add -b go-mavlink-bridge <sibling-worktree-path> <BASE_COMMIT>
```

Do not guess the base, copy dirty files between worktrees, or branch from an
older remote ref.

## Required reading

Read these completely before editing:

1. `docs/vehicle_configuration_roadmap.md`
2. `docs/gcs_runtime_blueprint.md`
3. `docs/mavlink_command_validation.md`
4. `docs/ardupilot_sitl_testing.md`
5. `docs/decisions.md`, especially ADR-0027 and ADR-0030 through ADR-0035
6. `contracts/README.md`
7. `contracts/wire/envelope.schema.json`
8. `contracts/wire/client-command.schema.json`
9. `contracts/wire/bridge-lifecycle-frame.schema.json`
10. `apps/mavlink-bridge/src/index.js`
11. `apps/mavlink-bridge/src/bridgeCore.js`
12. `apps/mavlink-bridge/src/normalize.js`
13. `apps/mavlink-bridge/src/mavlinkFrame.js`
14. `apps/mavlink-bridge/src/parameterProtocol.js`
15. `apps/mavlink-bridge/src/parameterRouter.js`
16. `apps/mavlink-bridge/src/parameterListRouter.js`
17. `apps/mavlink-bridge/src/systemRoutes.js`
18. `apps/mavlink-bridge/src/recording.js`
19. `apps/mavlink-bridge/src/replayIngress.js`

Read the corresponding `*.test.js` files with each implementation file. Also
check for an `AGENTS.md` introduced after this document and obey it if present.

Files such as `udpIngress.js`, `flightStateTracker.js`, `commandRouter.js`,
`missionRouter.js`, and the other command routers are important for later work,
but they are not first-branch implementation scope.

## First-branch scope

### Included

- Go module and repository commands.
- Platform-neutral MAVLink v1 and unsigned-v2 framing and CRC.
- The currently normalized message families and JSON-envelope input.
- Pure bridge-core counters, health, roster, and source-conflict behavior.
- Pure exact-target route mapping with an injected clock.
- JSONL recording **reading** and passive replay dispatch.
- `PARAM_REQUEST_READ` and `PARAM_REQUEST_LIST` encoding.
- Pure parameter read and list transaction folds.
- Independent parameter request vectors and parameter-list semantic cases.
- Node/Go contract comparison under a deterministic harness.
- Native development tests plus Linux amd64/arm64 cross-build checks.

### Excluded

- UDP or serial sockets.
- WebSocket or HTTP servers.
- Recording writes, retention, and replay looping.
- React/UI changes or a BFF.
- OpenAPI, gRPC, Protobuf, or WASM.
- `PARAM_SET` or any vehicle-state write.
- Mission requests, message-interval changes, mode/arm/Guided commands.
- systemd/Docker deployment, live SITL, and Pi hardware acceptance.
- Default-runtime switching or Node removal.

**Hard stop after Phase D. Do not begin the live-runtime phases in this branch.**

## Repository ownership

Expected new paths:

```text
apps/mavlink-bridge-go/
├── go.mod
├── cmd/conformance/
├── internal/mavlink/
├── internal/bridge/
├── internal/routes/
├── internal/recording/
├── internal/transactions/
└── README.md
```

The package split may change if an idiomatic Go boundary is clearer, but pure
folds must not depend on sockets, files, environment variables, real clocks, or
process globals.

Permitted shared edits:

- root `package.json` scripts for Go build/test/conformance;
- additive language-neutral fixtures and vectors required below;
- one additive Node conformance entry point that existing runtime modules do not
  import;
- documentation and CI configuration for this slice.

Avoid React, `gcs-core`, Node runtime behavior, Docker Compose, and unrelated
files. If the work reveals a Node/contract conflict, document it and stop rather
than changing both implementations inside the port.

## Known Node behavior that matters

These are facts to test or consciously classify, not instructions to reproduce
every implementation detail:

- `bridgeCore` attaches `health` to every emitted telemetry envelope.
- Health contains the packet-rate window, decode/drop counters, sorted message
  rates, and sorted live-system roster.
- When a normalized input sequence is zero, `bridgeCore` currently substitutes a
  process-global envelope count modulo 256. Preserve this **protocol-v0 output**
  in the first slice and record it as compatibility debt; do not generalize it
  into a new protocol design.
- Node recognizes the signed-v2 incompatibility flag and advances by the 13-byte
  signature length, but its CRC lookup uses the end of the signed frame rather
  than the checksum immediately after the payload. No signed fixture or accepted
  behavior exists. The first Go slice explicitly rejects signed MAVLink v2 and
  records signed-frame support/verification as later protocol work; it must not
  invent acceptance behavior or copy the apparent CRC bug.
- `index.js` ticks health/routes at one second and transaction routers at 100 ms.
  Pure transaction parity concerns timeout thresholds, retry counts, and ordered
  outputs when `tick(now)` is invoked. Exact OS scheduler cadence and event-loop
  drift are not portable contracts.
- `index.js` folds `HOME_POSITION` and `MISSION_*` messages through
  `missionRouter` and suppresses their raw normalized envelopes. That publish
  policy is later runtime scope; Phase B validates normalization only.
- Parameter read and list routers default the bridge MAVLink identity to
  `255:190`; only `missionRouter` currently reads the similarly named environment
  variables. For this slice, make GCS identity an explicit constructor input with
  a `255:190` default and test the default vectors. Do not decide global
  environment plumbing.
- Parameter read and list late-client caches retain request history without a
  bound. This is not a behavior to copy into the first slice. Snapshot retention
  belongs to the live-runtime decision described below.
- Node records lifecycle events synchronously in router emission order. A Go
  implementation may use a channel later, but it must preserve FIFO ordering; a
  channel does not inherently reorder events.
- Replay transmit-freedom is currently achieved because the replay ingress has no
  send method and routers reject non-live requests. Preserve method absence at
  the Go type/interface boundary.

## Decisions fixed for the first slice

### State ownership and ordering

Pure folds accept one input at a time and return zero or more ordered outputs.
They own no goroutines. Any later live process will funnel state mutations
through a single owner/event loop; `go test -race` is necessary but does not prove
event order.

### Time

All pure components accept explicit timestamps or an injected clock. Tests call
`tick(now)` directly. Do not model Node timer drift. Live monotonic-versus-wall
clock policy is deferred until the runtime phase; contract timestamps remain
explicit numeric values.

### GCS identity

Parameter request encoders receive source `sysId` and `compId` explicitly and
default test/application composition to `255:190`. No environment-variable
behavior is introduced in this slice.

### Snapshot retention

Phase D exposes current transaction results to its caller but does not implement
a process-lifetime late-client cache. Before a WebSocket runtime is started, a
separate decision must define bounded snapshot semantics and update Node and/or
the protocol evidence consistently. The Go agent must list the required decision
but must not choose a retention count or copy the unbounded maps.

### Resource hardening

Do not invent WebSocket sizes, connection counts, or queue depths in an offline
port. Protocol v0 currently permits very large mission commands and parameter
snapshots, so a 64 KiB limit would reject schema-valid traffic. Live limits must
be derived from contract maxima, measured Pi resources, and deployment needs,
then expressed in bytes as well as object counts.

### Raw-byte ownership

Phase D has no UDP read loop. Still, byte slices passed into a decoder or
recording reader must have explicit ownership: copy before retaining data beyond
the caller's buffer lifetime. This becomes mandatory when UDP is added.

## Phase A — scaffold and parity apparatus

Deliver:

- `apps/mavlink-bridge-go/go.mod` with an explicit Go language/toolchain policy;
- root `build:bridge-go`, `test:bridge-go`, and `conformance:bridge-go` scripts;
- native test execution and cross-build scripts for Linux amd64 and Linux arm64;
- repository-relative fixture loading independent of the caller's directory;
- a small architecture README;
- standard-library-only implementation unless a dependency is justified in the
  README; and
- no required network, Docker, or live vehicle.

Add a deterministic comparison apparatus:

- a Node entry point that drives pure modules only, never `index.js`;
- on the Node side, pass each recording's `atMs` explicitly to
  `core.ingestDatagram(data, atMs, source)` and pass every scheduled tick time
  explicitly to `core.tick(atMs)`; never exercise either method's `Date.now`
  default in a parity run;
- a fixed ordered input/tick schedule;
- a checked-in description of any comparison normalization; prefer injected
  values over zeroing fields after output;
- canonical JSON output with object keys normalized for comparison while array
  and event order remain significant; and
- a capability matrix mapping contract/fixture behaviors to Node and Go tests.

Do not create one manually maintained row for every incidental implementation
test. Give each matrix row a stable case ID and columns for behavior, evidence
artifact and provenance, Node status/test, Go status/test, and any explained
difference. The required rows are countable:

- one for each of the 15 normalized message families named in Phase B;
- one each for MAVLink v1 acceptance, unsigned-v2 acceptance, signed-v2
  rejection, bad CRC, truncation, unsupported input, and JSON-envelope input;
- one each for health, sequence fallback/wrap, roster/TTL, rate sorting, and
  duplicate-source conflicts;
- one for each Phase C route/replay gate; and
- one for each parameter vector and semantic-trace case named in Phase D.

Rows may be `complete`, `partial`, or `unstarted`, but none of these required
case IDs may be omitted. Add rows only when a new externally observable contract
or important negative path is deliberately added; ordinary unit-test growth does
not create matrix churn.

Gate from the repository root:

```bash
pnpm test:bridge
pnpm test:gcs-core
pnpm test:hud-ui
python3 contracts/conformance/heading_vectors.py
pnpm test:bridge-go
pnpm build:bridge-go
```

The Go scripts must enter the nested module themselves. Also run
`git diff --check`; `git status --porcelain` must show only intended branch work.

## Phase B — framing, normalization, and bridge core

Deliver:

- MAVLink v1 and unsigned-v2 frame extraction, CRC validation, v2 truncation
  handling, and safe rejection of malformed, signed, or unsupported input;
- normalization for all 15 message families currently handled by Node:
  `HEARTBEAT`, `PARAM_VALUE`, `ATTITUDE`, `GPS_RAW_INT`,
  `GLOBAL_POSITION_INT`, `VFR_HUD`, `COMMAND_ACK`, `MISSION_COUNT`,
  `MISSION_ITEM_INT`, `MISSION_REQUEST_INT`, `MISSION_REQUEST`,
  `MISSION_CURRENT`, `MISSION_ACK`, `HOME_POSITION`, and
  `GPS_GLOBAL_ORIGIN`;
- the existing JSON-envelope datagram input behavior;
- pure bridge health, global protocol-v0 sequence fallback, system roster, TTL,
  rate sorting, and duplicate-source conflict behavior; and
- malformed/truncated/oversized decoder cases that return errors without panic.

Fixture reality:

- `mixed-mavlink-v2.jsonl` has 17 entries covering message IDs `0`, `30`, `33`,
  `44`, `73`, and `74` only.
- Other message cases currently live in Node unit tests. Do not copy expected
  values directly into Go source. Promote any expectation required for
  cross-language comparison into an additive language-neutral fixture derived
  from the MAVLink dialect or an independently captured input.

Gate:

- the capability matrix names evidence for every normalized family and negative
  framing behavior;
- a signed-v2 negative case is rejected deterministically and documented as
  unsupported rather than misreported as a checksum-compatible frame;
- Node and Go produce semantically equal contract fields for shared cases under
  the same explicit clock/tick schedule;
- health and sequence are compared, not discarded; and
- `pnpm test:bridge-go` includes `go test -race ./...` and a Linux arm64 build.

## Phase C — exact-target routes and recording input

Deliver:

- a pure route table keyed by exact `sysId:compId`, with explicit timestamps and
  expiration;
- JSONL input compatible with `tMs`, `atMs`, `base64`, and `event` entries;
- passive dispatch that distinguishes raw datagrams from lifecycle events;
- deterministic, unpaced core replay driven by recorded `atMs` values.

Do not add pacing/timers, recording output, retention, loop mode, sockets, or
router event folding here. Transaction routers do not exist until Phase D.

Existing evidence:

- `mixed-mavlink-v2.jsonl` contains raw datagrams and no events.
- `mixed-sitl-parameter-write-v2.jsonl` contains 20 `parameterRead` events and 12
  `parameterWrite` events; it can prove event dispatch and later passive read
  folding, but it has no `parameterList` events.

Gate:

- raw recording input re-enters the same decoder/core path;
- two fixed-clock core folds are equal, with the Node harness passing every
  recording `atMs` and scheduled tick time directly into `ingestDatagram` and
  `tick`; calling those methods without a time argument fails the harness;
- event entries are dispatched as events, never decoded as MAVLink;
- the replay type has no outbound-send interface; and
- this phase creates no replay goroutines or timers.

## Phase D — read-only parameter bridge slice

This phase ports parameter transport behavior; it is a prerequisite for, not yet
the completion of, the vehicle-configuration feature.

Deliver:

- independent golden payload vectors for `PARAM_REQUEST_READ` by name, by index,
  and `PARAM_REQUEST_LIST`;
- exact MAVLink encoders using explicit GCS and target identities;
- pure single-read and list-assembly folds;
- exact-target correlation;
- name-versus-index matching;
- duplicate and out-of-order list handling;
- retries and failure when `tick(now)` crosses the documented thresholds;
- route-loss behavior through an injected route/send port;
- protocol-v0 `parameterRead` and `parameterList` lifecycle shapes; and
- passive folding of recorded lifecycle events into current transaction results,
  without a process-lifetime snapshot cache.

Evidence additions:

1. `contracts/mavlink/parameter-command-vectors.json`, independently derived
   from the MAVLink dialect and then checked against Node and Go. Compare payload
   bytes independently of mutable frame sequence; retain implementation-local
   full-frame CRC tests.
2. A language-neutral ordered parameter-list semantic trace covering start,
   out-of-order values, duplicate index, peer-target value, completion, idle
   retry/failure, route loss, replay rejection, and invalid target.
3. Reuse the existing sanitized `parameterRead` events where applicable. Do not
   claim they cover `parameterList`. A live raw-plus-lifecycle list recording is
   deferred until a live adapter/SITL phase can produce it with provenance.

Evidence limitation: there is no recorded `parameterList` event in the current
repository. The new ordered trace proves the pure list-fold semantics selected
for this port, but it does not independently prove that the Node live runtime or
an autopilot produces the same sequence. Mark the live `parameterList` evidence
row `partial` (semantic trace only) through Phase D. Closing that row requires a
provenanced raw-plus-lifecycle capture in the later live adapter/SITL phase; do
not manufacture a recording or silently upgrade the evidence status.

Gate:

- parameter vectors are consumed directly by Node and Go tests;
- lifecycle frames validate against
  `contracts/wire/bridge-lifecycle-frame.schema.json`;
- cross-target responses cannot complete or advance another target;
- list results are deterministic despite arrival order;
- retry count and timeout threshold match Node when `tick(now)` is invoked,
  without requiring a 100 ms OS scheduler;
- replay input cannot produce outbound bytes; and
- the capability matrix contains no unexplained first-slice differences.

## Later work — not authorized in the first branch

### Phase E — live read-only runtime

Add UDP ingress, WebSocket protocol v0, recording output/retention, replay
pacing/looping, flight-state tracking, bounded late-client snapshots, and
graceful process shutdown.

Before implementation, resolve and document:

- bounded snapshot-retention semantics across Node and Go;
- maximum inbound/outbound message bytes consistent with protocol v0;
- per-client queue **byte** limits and slow-client behavior;
- configurable connection limits for local versus cloud profiles;
- wall timestamps versus monotonic deadlines;
- global GCS identity configuration; and
- a maintained, minimal Go WebSocket dependency.

The current React GCS can validate telemetry compatibility but has no parameter
read/list UI. Add a small read-only integration controller or defer parameter UI
validation to the vehicle-configuration milestone. Do not port the generic
`commandRouter` shell merely to make the process resemble Node.

### Phase F — mixed-SITL and deployment acceptance

Validate exact-target Copter/Plane reads, route loss, reconnect, restart, peer
isolation, raw-plus-lifecycle recording, and passive replay. The existing Compose
baseline is Linux/arm64 on Apple Silicon and is not x86-only.

Validate portability with at least:

- native macOS arm64 development tests;
- Linux amd64 build/test;
- Linux arm64 build/test; and
- Raspberry Pi 5 Linux/arm64 hardware acceptance.

Pi 5 acceptance records topology, CPU/RSS, UDP receive/drop counters, recording
write volume, storage location, reconnect, and supervised restart. Pi 5 includes
an RTC and optional backup battery; test the actual RTC/NTP configuration and
clock jumps rather than assuming no RTC. Use an explicit absolute recording
directory under supervision. Do not prescribe tmpfs or external storage until
write-volume and persistence requirements are measured.

If Pi hardware is unavailable, leave the hardware gate open. A cross-build is
not hardware evidence.

### Phase G — existing outbound-family parity

Port one reviewed family at a time:

1. mission read and message request;
2. message interval;
3. low-consequence parameter write;
4. mission upload;
5. mode change;
6. standard arm/disarm; and
7. Guided reposition, takeoff, and land.

Preserve default-off write gates, exact-target routing, ACK/post-condition
correlation, retries, lifecycle recording/replay, and each family's SITL evidence.
Mission reads are read-safe but still outbound and can interfere with another
simultaneous requester; never run two active bridge instances against one route.

### Phase H — default-runtime cutover

Cutover requires all reachable Node behaviors, cross-platform tests, Pi 5
evidence, UI compatibility, environment/runbook parity, rollback to Node, and no
unexplained contract differences. Node removal is a later explicit decision.

## Open questions and stop conditions

Create `docs/go_bridge_open_questions.md` only when an actual unresolved question
exists. Record:

- the affected contract, symbol, or fixture;
- why the authority hierarchy does not resolve it;
- safe options and their observable consequences; and
- which phase is blocked.

Add a minimal failing language-neutral case when the issue is behavioral. Commit
the evidence. Stop the affected phase when the question changes safety,
protocol-v0 output, or scope. Independent earlier work may continue; do not halt
the entire branch for a cosmetic or nonblocking question.

An explicit open-question audit is required at every phase gate and in the final
report. It must name the contracts, fixtures, and Node behaviors checked for that
phase and either link the unresolved entries or state `none found`. The absence
of `docs/go_bridge_open_questions.md` is not evidence that the audit happened and
does not by itself satisfy the gate.

Stop rather than guess when:

- contracts and Node disagree materially;
- a change would weaken exact-target or replay safety;
- a new dependency/service/code generator is required;
- a bounded-resource policy would reject currently valid protocol-v0 traffic;
- the work crosses into live networking, UI, writes, or protocol v1; or
- closing a claimed gate requires unavailable SITL/Pi evidence.

## Verification and reporting

The root scripts must encapsulate the nested Go module. The accumulated first
slice runs:

```bash
pnpm test:bridge
pnpm test:gcs-core
pnpm test:hud-ui
python3 contracts/conformance/heading_vectors.py
pnpm test:bridge-go
pnpm build:bridge-go
pnpm conformance:bridge-go
git diff --check
```

`test:bridge-go` must include `go vet ./...`, `go test ./...`, and
`go test -race ./...` from `apps/mavlink-bridge-go`. `build:bridge-go` must build
at least native, `linux/amd64`, and `linux/arm64` with `CGO_ENABLED=0` for the
first-slice standard-library code.

The final agent report must include:

- base commit and branch/worktree name;
- commits made by phase;
- commands run and exact outcomes;
- capability matrix with complete/partial/unstarted status;
- contract additions and their independent provenance;
- the open-question audit, including `none found` when appropriate, plus
  intentionally deferred decisions;
- tests not run; and
- confirmation that Phase E was not started.

## First-agent completion definition

A complete first handoff contains:

- scaffold and cross-build commands;
- deterministic conformance apparatus;
- framing/normalization/core parity;
- exact-target route and JSONL input behavior;
- parameter request vectors and list semantic trace;
- pure parameter read/list folds with protocol-v0 lifecycle output;
- Node/Go semantic parity results under injected time;
- no late-client cache decision hidden in the implementation;
- no live sockets, recording writer, vehicle writes, or transport expansion; and
- a precise remaining-work summary for Phases E–H.
