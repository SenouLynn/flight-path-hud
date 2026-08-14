# Portable vehicle configuration roadmap

## Goal

Make vehicle configuration the next major GCS capability and the shared
foundation for later PID tuning. The first promoted milestone is read-only:
identify the exact vehicle and firmware, retrieve its parameter inventory,
resolve trustworthy metadata, and preserve a deterministic snapshot without
changing vehicle state.

This is intentionally smaller than Mission Planner and more disciplined than a
generic parameter editor. It should provide a portable configuration domain that
can be implemented by the current Node bridge, a future Go bridge, or another
runtime without moving safety policy into React or binding it to one transport.

Raspberry Pi 5 running 64-bit Linux is a definitive deployment target. The
configuration bridge and its evidence harness must run locally on that platform,
offline, with direct access to supported telemetry adapters. Cloud deployment and
developer workstations remain useful profiles, but Pi 5 compatibility is an exit
condition rather than a future optimization.

## Product boundary

Vehicle configuration owns:

- exact vehicle, component, firmware, and parameter-set identity;
- parameter discovery, metadata resolution, typed values, and availability;
- immutable snapshots, staged diffs, verification, restoration, and audit;
- curated vehicle- and firmware-specific configuration groups; and
- capability and lifecycle state exposed to operator surfaces.

PID tuning is a curated configuration module. It reuses the same identity,
metadata, snapshot, staging, transaction, verification, restoration, and audit
model, then adds controller-specific grouping, narrower policy bounds, linked
axes, response evidence, and separately gated in-flight authority.

The first milestones do not include sensor/radio/motor calibration, firmware
flashing, unrestricted parameter editing, automatic configuration repair, or
in-flight writes. Calibration often requires command-driven state machines,
physical prompts, progress reporting, and reboot behavior; it belongs in a later
capability family when the runtime and evidence model are more mature.

## Architectural boundaries

### Portable contracts

Contracts describe facts and lifecycle transitions, not framework objects:

- `VehicleConfigurationIdentity`: exact `sysId:compId`, autopilot and vehicle
  types, firmware version/hash when available, parameter-set fingerprint, and
  freshness/provenance;
- `ParameterValue`: name, MAVLink type, typed value, observed index/count, and
  observation time;
- `ParameterMetadata`: description, units, increment, range, enum/bitmask
  options, read-only and reboot requirements, source/version, and confidence;
- `ParameterInventory`: bounded list assembly progress, missing names/indexes,
  duplicates/conflicts, completion state, and identity binding;
- `ConfigurationSnapshot`: immutable identity-bound values plus metadata version
  and capture evidence; and
- lifecycle events for discovery, metadata resolution, snapshot creation, and,
  later, staged/apply/verify/restore transactions.

JSON Schema remains the protocol-v0 producer boundary. Language-neutral semantic
traces and known-answer fixtures define ordering, reconciliation, and failure
behavior. MAVLink encoders retain golden-byte vectors. A future protobuf or gRPC
adapter must conform to the same behavior; generated transport types do not
become the domain model.

### Domain and application ports

Pure configuration-domain folds own list assembly, identity binding, metadata
merge rules, type-aware comparison, fingerprints, diffs, and lifecycle state.
They have no socket, filesystem, clock, React, Node, or Go dependency.

Application ports provide parameter read/list ingress and lifecycle output,
firmware identity and metadata lookup, snapshot persistence/export,
recording/replay, and, later, policy-authorized parameter transactions.

UDP, serial, replay files, WebSocket JSON, protobuf, and gRPC are adapters around
those ports. React consumes a client adapter and never owns transaction policy.

### Client target remains open

React in a browser is the current validation client, not a committed production
UI target. Raspberry Pi 5 with 64-bit Linux is a committed host target, while a
Pi-attached Chromium kiosk, packaged webview, native desktop UI, remote browser,
and specialized embedded/display clients remain candidates. Evaluate them later
against offline operation, device access, latency, packaging/update burden,
resource use, accessibility, and field maintainability. No domain or bridge
contract may assume a browser runtime.

WASM is an optional adapter for pure, deterministic domain logic when sharing one
implementation with C++/Rust or reducing a measured client hot path has value.
It is not a default backend: browser sandboxes do not provide the bridge's normal
UDP/serial/filesystem/process capabilities, and moving transaction ownership
into a UI client would weaken supervision and replay. Language-neutral fixtures
remain the portability mechanism whether a client uses TypeScript, WASM, native
code, or some combination.

## Iteration plan

### 0. Precedent and source validation

Before shaping UI or contracts, build a comparison matrix from current
QGroundControl, Mission Planner, MAVLink, and ArduPilot behavior:

- vehicle/firmware identity establishment and invalidation;
- parameter-list download, cache, retry, missing-item, and refresh behavior;
- classic MAVLink parameter typing and float transport;
- metadata source/version matching, enums, bitmasks, bounds, increments,
  read-only values, and reboot warnings;
- modified/favorite/search/group presentation; and
- snapshot/import/export/diff behavior.

Record adopted behavior and deliberate deviations. Product precedent informs the
workflow; MAVLink and ArduPilot documentation plus observed SITL behavior remain
authoritative for protocol semantics.

### 1. Read-only contract slice

1. Specify strict identity, inventory, metadata, snapshot, and lifecycle schemas.
2. Add semantic traces for complete, partial, duplicate, out-of-order, timeout,
   stale-route, reconnect, target-change, firmware-change, and replay cases.
3. Add exact MAVLink request bytes and captured response fixtures where needed.
4. Define bounded inventory and metadata limits before accepting remote data.
5. Define a deterministic parameter-set fingerprint independent of list order.

Exit: an independent implementation can reproduce the read lifecycle and
snapshot from the contracts without importing TypeScript code.

### 2. Pure domain implementation and unit evidence

1. Extract list reconciliation from process/socket wiring into a pure fold.
2. Implement identity freshness and invalidation rules.
3. Implement metadata merge and explicit missing/mismatched-metadata states.
4. Preserve MAVLink types instead of treating all values as JavaScript numbers.
5. Build immutable snapshots and stable diffs.
6. Run the same semantic fixtures through TypeScript and a second conformance
   runner; Go is the preferred candidate for that runner and eventual bridge.

Exit: unit and cross-language conformance tests cover every read-only state and
no test requires React or a live socket.

### 3. Mixed-vehicle SITL read validation

Validate ArduCopter and ArduPlane independently with both present:

- exact-target list and named reads;
- parameter count/index changes and missing-item recovery;
- duplicate, delayed, and out-of-order `PARAM_VALUE` traffic;
- route loss, reconnect, simulator reboot, and firmware identity change;
- peer isolation and bounded resource use; and
- sanitized recording followed by deterministic, transmit-free replay.

Exit: repeated reads cannot affect vehicle state, cross-target contamination is
absent, and replay reconstructs the same final inventory and snapshot.

### 4. Read-only UI validation

Add a top-level **Vehicle configuration** workspace with:

- exact target, vehicle type, firmware, freshness, and metadata confidence;
- download/refresh progress and explicit incomplete/error states;
- searchable parameter inventory with typed formatting;
- curated groups separated from the complete inventory;
- source, units, bounds, enum/bitmask, reboot, and read-only presentation; and
- snapshot capture, diff, and export with no apply control.

Rename the current GCS `Parameters` telemetry table to `MAVLink fields` or
`Telemetry inspector`; it is a telemetry registry, not an autopilot parameter
inventory.

Exit: mock, replay, and live SITL UI passes demonstrate that target changes,
staleness, metadata gaps, and incomplete lists are impossible to mistake for a
complete current configuration.

### 5. Write-capability exploration

Only after the read milestone is accepted:

1. Threat-model stale baselines, partial batches, reconnects, firmware changes,
   type conversion, read-only behavior, and concurrent commands.
2. Specify staged changes and immutable before/after evidence without adding UI
   transmission controls.
3. Extend contracts with single-target serialization, policy decisions,
   acknowledgment, independent read-back, mismatch, reconciliation, and restore.
4. Validate a reversible, low-consequence, disarmed SITL parameter before
   creating general configuration groups.
5. Promote narrowly curated groups one at a time; metadata bounds are never the
   sole safety policy.

PID tuning begins after this transaction model exists. Its initial disarmed
workflow is the first demanding consumer of the configuration foundation, not a
parallel parameter implementation.

## Go and transport evolution

Go is the preferred backend-portability experiment because a small static
Linux/arm64 process is a good fit for UDP/serial ingress, per-target transaction
workers, timers, recording, and Raspberry Pi 5 deployment. Use a strangler path:

1. Keep protocol-v0 WebSocket JSON and current fixtures stable.
2. Implement the read-only configuration folds and conformance runner in Go.
3. Feed recorded fixtures through Node and Go and require equivalent normalized
   lifecycle output.
4. Run the Go adapter against mixed SITL while Node remains the reference.
5. Run the bridge and replay/conformance suite on a Pi 5 Linux host, including
   direct-link disconnect/reconnect and bounded-resource checks.
6. Switch the bridge runtime only after parity; retain an easy rollback path.
7. Decide protocol v1 separately, with measured browser and non-browser needs.

Do not equate protobuf with gRPC. Protobuf may become a useful language-neutral
IDL or binary envelope while WebSocket remains the browser transport. Native
gRPC is attractive between backend/edge processes and for Go or C++ clients, but
official gRPC-Web does not currently provide client or bidirectional streaming.
The React boundary may therefore remain WebSocket-based, or later split into
unary/server-streaming configuration RPCs plus a WebSocket telemetry/command
channel. No transport is promoted until it preserves target isolation, lifecycle
ordering, recording/replay, unknown-field policy, and browser operability.

Go does not itself make a later C++ or Elixir rewrite automatic. The portable
assets are the contracts, semantic traces, golden bytes, and port boundaries;
the Go implementation is another consumer and a stronger production candidate.

## Evidence gate

The read-only vehicle-configuration milestone is complete only when:

1. current-product and authoritative protocol research is recorded;
2. every new frame has a strict schema and valid/invalid fixtures;
3. ordered semantic traces cover success and failure paths;
4. TypeScript and an independent runner agree on known-answer results;
5. mixed Copter/Plane SITL proves exact-target isolation and recovery;
6. recording/replay is deterministic and cannot transmit;
7. the UI exposes identity, freshness, completeness, and metadata confidence;
8. snapshots are immutable, typed, identity-bound, and exportable;
9. no browser control or bridge path can write a vehicle parameter; and
10. the bridge and evidence harness pass on Raspberry Pi 5 Linux/arm64; and
11. protocol-v1 and backend migration remain optional adapters rather than
    prerequisites for the feature.
