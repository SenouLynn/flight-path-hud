# Live MAVLink runtime precedents

Research date: 2026-08-14. Upstream references point to the official
QGroundControl and Mission Planner repositories/documentation on their moving
default branches. Treat source-path observations as revision-sensitive and
re-check them when implementing a runtime phase.

Status: planning draft. Phase E0 must attach an upstream revision/access date,
direct URL and stable symbol/path, deliberate deviation, and explicit
observation-versus-inference label to every matrix row before treating this as
gate evidence.

This note extracts behavioral precedent for the Go bridge. It does not make
either upstream architecture authoritative over this repository's contracts,
fixtures, ADRs, or SITL evidence.

## Adopted comparison

| Concern | QGroundControl | Mission Planner | Adopted local rule |
| --- | --- | --- | --- |
| Link versus vehicle | `LinkManager`/`LinkInterface` are separate from `Vehicle`; a vehicle owns a `VehicleLinkManager`. | Each `MAVLinkInterface` owns a link-local `MAVList`; selected link/vehicle are separate mutable UI concepts. | Transport is a capability. Domain state is never keyed only by socket or UI selection. One owner manages explicit link, system, and component identities. |
| Vehicle discovery | Creates a vehicle from accepted HEARTBEAT/HIGH_LATENCY traffic for autopilot component 1, filtering GCS/peripheral types and invalid/colliding IDs. | Clears link-local state on open, ignores GCS/compid-0 heartbeat, and requires repeated qualifying heartbeat observations before selecting a vehicle. | Admit a vehicle only after an accepted autopilot heartbeat. Preserve component identity beneath that vehicle. Exact numeric confirmation counts require local trace/SITL evidence rather than copying either product. |
| UDP endpoints | Learns UDP session targets and broadcasts link writes to configured/learned targets; targets clear on disconnect. The list is not visibly bounded. | Link ownership and current vehicle are distinct, but convenience APIs can target the selected vehicle. | Learn only from accepted raw MAVLink in live mode, cap and expire endpoints, and route a read to one exact `(sysId, compId)` endpoint. Never broadcast or use the selected UI vehicle as authority. |
| GCS identity | Configurable process GCS sysid, normally 255, fixed mission-planner component, heartbeat on connected links. | Defaults sysid to 255, allows saved override, and emits GCS heartbeat per open link. | Parse one immutable process `(gcsSysId,gcsCompId)`, default `255:190`, and inject it into every encoder. Phase E does not add a GCS heartbeat because that is new periodic outbound traffic; revisit with protocol evidence. |
| Parameter acquisition | Per-component counts/missing indices, list retries, quiet-time missing-index reads in bounded batches, bounded per-index retries, and explicit ready/degraded state. | Builds a temporary list, exact-target filters, retries initial list, requests missing indexes in bounded batches, and commits only on exact completeness. | Stage per exact target; never expose a partial list as complete. After quiet time, repair missing indices with bounded `PARAM_REQUEST_READ` batches. Publish progress and terminal incomplete/failure evidence. |
| Parameter cache | PX4 hash cache only; deliberately avoids broad ArduPilot cache reuse because values may be volatile. | Persistent cache key includes autopilot type, hardware UID, sysid, and compid; reuse is age-limited. | No persistent parameter cache in Phase E. Late-client memory is bounded, process-local, freshness-labelled, and cleared on vehicle epoch loss. Persistent cache waits for firmware/hardware identity contracts. |
| Read-only transmission | Read operations are isolated in managers; signing/controller policy is separate. | `ReadOnly` is an explicit outbound-message allowlist containing mission/parameter/fence/rally reads. | Read-only means a closed capability interface, not a generic UDP sender with flags. Phase E exposes only parameter read/list methods. |
| Concurrency/order | UDP work runs on a dedicated thread; queued delivery and blocking link teardown preserve ownership/lifecycle. | A serialized reader and per-interface semaphore protect parse/sequence state; writes have separate locking. | One Go owner goroutine orders parse, route, state, transaction, record, and publish mutations. Adapter goroutines submit immutable events only. |
| Logging | Timestamped raw MAVLink logging is on the protocol path and includes received and sent frames; replay is exclusive with live connections/logging. | Tlogs automatically record timestamped MAVLink in both directions and replay through normal parsing/state paths. | Record inbound raw datagrams and outbound read-request bytes with direction and wall timestamp. Replay uses the same domain ingress but treats outbound records as passive evidence and has no sender. |
| Signing/trust | Current source has per-link signing policy and rejects bad signatures before normal dispatch; key-setup material is excluded from forwarding/logging. | Verifies signed packets against vehicle/auth keys; ArduPilot documents that signing authenticates commands but does not encrypt telemetry. | UDP is not authenticated merely because it is local. Phase E continues to reject signed-v2 and unknown incompatibility flags, records no key material, and documents signed-link operation as unsupported pending a separate security decision. |
| Reconnect/liveness | Separates link reconnect from vehicle loss and resets parse/loss metadata on reconnection. | Clears link-local MAV state on open; cache reuse, when enabled, is separately qualified. | UDP listener lifetime is separate from vehicle/route lifetime. Route loss fails active operations closed; reacquisition creates a new vehicle epoch and cannot silently reuse stale parameter state. |
| Resource limits | Bounds link/channel count and delivery batching, but learned UDP targets and queued delivery are not useful byte-budget precedent. | Has finite parser/read behavior and small packet histories, but no browser slow-client model. | Keep explicit local connection, queue-byte, snapshot-byte, transaction, endpoint, and message limits. These are deliberate Pi/browser hardening, not upstream parity. |
| Shutdown | Suspends connections, disconnects links, waits for worker threads, and drains late events. | Disposes link/read resources, but its global/UI lifecycle is not a direct service template. | Stop accept/ingress/ticks, drain owner, close clients, flush recorder, wait for goroutines, and return from `main`; prove idempotence and startup-failure cleanup. |

## Parameter transaction consequences

The common upstream behavior is stronger than this repository's initial
whole-list retry fold. Phase E should amend the language-neutral trace before
opening sockets:

1. send one `PARAM_REQUEST_LIST` to an exact target;
2. stage values by `paramIndex`, preserving the advertised count invariant;
3. after a 3,000 ms quiet interval, if no valid value arrived, retry the list at
   most twice;
4. once a count is known, request missing indexes with exact
   `PARAM_REQUEST_READ` messages in ascending batches of at most 10 per quiet
   interval;
5. allow at most three requests per missing index and a 60,000 ms total
   transaction lifetime;
6. publish progress without exposing staged values as a complete inventory;
7. commit only when every index in `[0,paramCount)` is present; and
8. on route loss, count change, resource limit, or exhausted repair, fail with
   explicit received/expected/missing evidence and release active state.

The upstream products use different timeouts and retry counts. Their shared
shape is precedent; these initial local constants must be pinned by semantic
traces. Phase F may tune them only through an ADR and mixed-SITL evidence.

## Security and routing consequences

QGC's learned UDP destinations are useful compatibility precedent but are not a
safe routing model for this bridge: QGC broadcasts writes across learned session
targets, while this project promises exact-target isolation. Mission Planner's
selected-target conveniences are similarly unsuitable for a headless service.

For Phase E:

- strict JSON-envelope UDP is mock-only and default-off because it can otherwise
  claim an arbitrary system/component route;
- malformed or unsupported raw traffic never creates a route;
- a fresh route for an exact target is not silently replaced by a competing
  endpoint; report the conflict and retain the incumbent until expiry;
- route expiry and vehicle epoch loss invalidate pending requests and cached
  freshness; and
- signing remains unsupported rather than partially trusted. Signed frames are
  rejected and counted, never downgraded to unsigned.

## Recording consequences

Both mature products treat raw, timestamped MAVLink logs as operational evidence
and keep replay separate from a live link. Extend the repository's JSONL format
additively:

- raw entries gain `direction: "inbound" | "outbound"`;
- inbound entries require a bounded non-secret source label; outbound entries
  require the exact target, a `sent|failed` outcome, and bounded nullable reason,
  but no signing key or credential;
- legacy raw entries without `direction` mean `inbound`;
- lifecycle entries remain normalized protocol-v0 evidence;
- replay feeds only inbound raw entries into the decoder and folds lifecycle
  entries passively; outbound entries are observable audit evidence and can
  never be transmitted; and
- record exact encoded byte length and preserve a valid prefix on cap/write
  failure.

Unlike QGC and Mission Planner, the bridge records malformed inbound datagrams
before decode because parser failures are part of the evidence this project
needs. The divergence must remain explicit.

## Primary upstream references

### QGroundControl

- [UDP link implementation](https://github.com/mavlink/qgroundcontrol/blob/master/src/Comms/UDPLink.cc)
- [Link manager lifecycle](https://github.com/mavlink/qgroundcontrol/blob/master/src/Comms/LinkManager.cc)
- [MAVLink protocol parsing/logging](https://github.com/mavlink/qgroundcontrol/blob/master/src/Comms/MAVLinkProtocol.cc)
- [Multi-vehicle discovery](https://github.com/mavlink/qgroundcontrol/blob/master/src/Vehicle/MultiVehicleManager.cc)
- [Vehicle dispatch and link association](https://github.com/mavlink/qgroundcontrol/blob/master/src/Vehicle/Vehicle.cc)
- [Parameter manager](https://github.com/mavlink/qgroundcontrol/blob/master/src/FactSystem/ParameterManager.cc)
- [MAVLink settings documentation](https://docs.qgroundcontrol.com/Stable_V5.0/en/qgc-user-guide/settings_view/mavlink.html)
- [MAVLink log format](https://docs.qgroundcontrol.com/Stable_V5.0/en/qgc-dev-guide/file_formats/mavlink.html)
- [Log replay implementation](https://github.com/mavlink/qgroundcontrol/blob/master/src/Comms/LogReplayLink.cc)

### Mission Planner and ArduPilot

- [MAVLink interface](https://github.com/ArduPilot/MissionPlanner/blob/master/ExtLibs/ArduPilot/Mavlink/MAVLinkInterface.cs)
- [Per-interface MAV list](https://github.com/ArduPilot/MissionPlanner/blob/master/ExtLibs/ArduPilot/Mavlink/MAVList.cs)
- [Per-vehicle state and parameter cache](https://github.com/ArduPilot/MissionPlanner/blob/master/ExtLibs/ArduPilot/Mavlink/MAVState.cs)
- [Application connection lifecycle](https://github.com/ArduPilot/MissionPlanner/blob/master/MainV2.cs)
- [Mission Planner telemetry-log documentation](https://ardupilot.org/planner/docs/mission-planner-telemetry-logs.html)
- [ArduPilot MAVLink2 signing documentation](https://ardupilot.org/dev/docs/common-MAVLink2-signing.html)
