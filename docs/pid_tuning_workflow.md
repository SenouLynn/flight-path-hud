# Linked PID tuning workflow

## Goal

Remove the repeated battery/USB cycle from manual vehicle tuning while preserving
the pilot's direct authority over the aircraft. A linked operator should be able
to land, disarm, change a bounded set of gains, verify the result, and fly again
without disconnecting the telemetry link. A later, separately gated phase may
allow a co-pilot to apply small bounded gain changes in flight.

This is a parameter-management workflow, not a new flight controller or a custom
automatic tuning algorithm. ArduPilot remains authoritative for control loops,
flight modes, failsafes, and native AutoTune behavior.

## Operator model

- **Pilot:** owns the transmitter, the flight-mode switch, and the immediate
  decision to stop a test. The pilot must be able to recover without using the
  browser or waiting for the co-pilot.
- **Co-pilot/tuner:** observes response data, prepares a bounded change, names
  the exact target, and submits it through the GCS policy boundary.
- **Bridge:** validates target, vehicle/firmware identity, state freshness,
  allowlist, bounds, transaction ordering, and read-back. It records every
  request and result and never gains authority merely because telemetry exists.
- **Autopilot:** applies parameters and reports its current value through
  MAVLink. Its normal modes and failsafes remain the recovery mechanism.

## Delivery phases

### Phase 1 — disarmed wireless tuning

The first useful release replaces the cable loop:

1. Retrieve the exact vehicle's parameter list and firmware/vehicle identity.
2. Present curated, vehicle-specific PID groups with metadata, current values,
   units, increments, and bounds.
3. Stage edits locally; typing never transmits.
4. Capture an immutable pre-change snapshot.
5. Require exact-target and operator confirmation.
6. Apply a bounded batch while the vehicle is disarmed.
7. Read every changed parameter back independently.
8. Mark each value `staged`, `sent`, `verified`, `mismatched`, or `restored`.
9. Preserve the snapshot as a named tuning session and offer verified restore.

Initial scope should be one firmware family and one controller group. The
recommended first slice is ArduCopter roll/pitch rate control:

- `ATC_RAT_RLL_P`, `ATC_RAT_RLL_I`, `ATC_RAT_RLL_D`, `ATC_RAT_RLL_FF`
- `ATC_RAT_PIT_P`, `ATC_RAT_PIT_I`, `ATC_RAT_PIT_D`, `ATC_RAT_PIT_FF`

Roll/pitch linking is a UI convenience, not one protocol transaction. Each
parameter remains independently addressed, acknowledged, read back, and
restorable.

### Phase 2 — armed bench and isolated-SITL validation

Exercise the same transaction path while armed, first in mixed SITL and then on
a non-propulsive bench setup. Prove:

- exact-target isolation with a peer vehicle present;
- loss of route before, during, and after a batch;
- partial batch failure and deterministic reconciliation;
- stale heartbeat, reconnect, replay, reboot, and changed-firmware behavior;
- pilot abort while a co-pilot has a staged or pending change;
- snapshot restoration after success, rejection, timeout, and restart; and
- recording/replay of the complete tuning audit without transmitting on replay.

This phase does not authorize flight.

### Phase 3 — bounded in-flight co-pilot tuning

In-flight writes are a distinct capability, disabled by default and unavailable
merely because disarmed tuning is enabled. The initial flight surface should:

- expose only an allowlisted controller/axis and one pending trial at a time;
- express changes as small deltas from the latest verified value (for example,
  `+2%`), then enforce both percentage and absolute metadata/policy bounds;
- reject arbitrary text entry and unrestricted parameter browsing;
- pin confirmation to vehicle, component, firmware identity, parameter set,
  baseline values, proposed values, operator, and timestamp;
- require a fresh live link and fresh vehicle state throughout the transaction;
- block on failsafe, unexpected mode/state, target change, reconnect, or another
  pending state-changing command;
- read back every value before another trial is permitted; and
- record telemetry before and after the change for later comparison.

The first flight implementation should change one parameter or one explicitly
linked roll/pitch pair. Larger batches make cause/effect ambiguous and increase
the partial-failure surface.

## Safety invariants

1. **Pilot recovery never depends on the GCS.** A transmitter mode/aux switch is
   the immediate escape. Browser buttons and network round trips are not an
   emergency stop.
2. **No automatic rollback during an unstable response.** Blindly sending more
   parameter writes during loss of control can worsen the situation or arrive
   too late. The pilot first exits the test condition; restoration occurs only
   after stable state is re-established and explicitly requested.
3. **Exact target only.** Every read, write, retry, result, snapshot, and chart is
   bound to `sysId:compId` plus observed firmware/vehicle identity. There is no
   most-recent-sender or active-vehicle fallback.
4. **Verified baseline required.** A delta is calculated from a freshly read,
   type-correct value—not from a cached UI value or an old profile.
5. **One transaction at a time per target.** Mode, arm, mission, and tuning
   transactions may not race each other.
6. **Metadata bounds are necessary but not sufficient.** Firmware metadata
   describes representable/recommended ranges; the project may impose a much
   narrower tuning envelope by vehicle family and phase.
7. **Profiles are identity-bound.** A saved tune records vehicle class, firmware
   version, parameter names/types, metadata version, and source vehicle. Loading
   a profile on a different target produces a diff for review, never an implicit
   write.
8. **Replay is permanently transmit-free.** Replayed tuning sessions may drive
   charts and audit views but never parameter writes.

## Transaction semantics and gotchas

### `PARAM_VALUE` is the protocol acknowledgment

MAVLink `PARAM_SET` is acknowledged by a `PARAM_VALUE` containing the autopilot's
current value. A response does not by itself prove the requested value was
accepted; the returned value must match using type-aware comparison, followed by
an independent read when closing a safety-sensitive batch. ArduPilot may briefly
report the requested value for a read-only parameter and then report the original
value, so completion must tolerate and detect this behavior rather than accepting
the first matching packet blindly.

### Types and float transport

Classic MAVLink parameter values travel through a float field while `param_type`
describes the underlying type. Encoding rules differ between implementations,
and precision can be lost for large integers. Preserve the observed ArduPilot
type, apply type-aware rounding/comparison, and do not treat every parameter as a
free-form JavaScript number.

### Names beat indexes

ArduPilot can hide or reveal subsystem parameters dynamically; `param_count` and
indexes may change, and the index for a named parameter is not stable. Tuning
transactions and profiles must use parameter names. Indexes are only for list
assembly and missing-item recovery.

### Metadata is firmware-specific

Parameter names, descriptions, ranges, increments, reboot requirements, and
availability vary by vehicle and firmware. Retrieve the actual parameter list
from the connected vehicle and resolve a versioned ArduPilot metadata artifact
for presentation. Do not hard-code one current web parameter page as universal
truth. If metadata is missing or mismatched, fall back to read-only inspection or
the project's narrowest known-safe policy.

### Persistence and immediate effect

Assume a successful GCS parameter write persists and can affect the running
controller immediately unless authoritative metadata and vehicle evidence say
otherwise. A "Save" button must not imply that prior edits were harmless or
temporary. UI labels should use `Stage`, `Apply`, `Verified`, and `Restore`, not
ambiguous desktop-form language.

### Telemetry is observation, not a stability oracle

`PID_TUNING` supplies axis, desired/achieved response, FF/P/I/D contributions,
and optional slew/modifier fields. It is valuable for live comparison and replay,
but packet loss, rate limits, and link latency mean the GCS cannot certify
stability from it. Onboard logs remain the higher-rate post-flight evidence.

### Stream cost

ArduPilot uses `GCS_PID_MASK` to select PID axes sent to the GCS. Enabling every
axis at high rate can compete with essential telemetry on a constrained link.
The workspace should request only the active axis, display effective cadence and
packet loss, restore prior stream configuration when the session ends, and never
equate a quiet chart with a quiet controller.

## UI outline

- **Header:** exact target, vehicle type, firmware version, armed/mode state,
  heartbeat age, link health, and tuning capability state.
- **Parameter groups:** current, staged, delta/percent, metadata bounds,
  verification state, and reboot/immediate-effect warning where known.
- **Change set:** before/after diff, operator, target binding, validation result,
  and explicit apply confirmation.
- **Session controls:** snapshot, apply, restore last verified, save profile,
  compare profile, and export audit.
- **Response view:** desired versus achieved plus FF/P/I/D contributions by axis;
  annotate the exact verified parameter-change time.
- **Flight mode:** deliberately sparse delta controls and a prominent statement
  that the transmitter/mode switch—not the browser—is the abort path.

## Evidence gates

Each promoted tuning family must demonstrate:

1. schema and golden-byte coverage for its request/lifecycle messages;
2. metadata/type/bounds tests for supported firmware and vehicle classes;
3. exact-target, duplicate, timeout, reconnect, and partial-batch tests;
4. immutable before/after snapshots and verified restoration;
5. deterministic, transmit-free replay of a sanitized session;
6. mixed-vehicle SITL isolation and firmware-specific parameter presence;
7. non-propulsive bench evidence before any flight enablement; and
8. a written flight test card naming pilot/co-pilot roles, test envelope,
   increment limits, abort conditions, and cleanup verification.

## Primary resources

- [ArduPilot: getting and setting parameters](https://ardupilot.org/dev/docs/mavlink-get-set-params.html)
  — ArduPilot types, list recovery, write/read-back behavior, hidden parameters,
  and why name-based access is required.
- [MAVLink parameter protocol](https://mavlink.io/en/services/parameter.html)
  — normative transaction, acknowledgment, encoding, and capability behavior.
- [ArduPilot GCS resources](https://ardupilot.org/dev/docs/gcs-resources.html)
  — machine-readable parameter metadata and log definitions.
- [MAVLink `PID_TUNING` message](https://mavlink.io/en/messages/ardupilotmega.html#PID_TUNING)
  — desired/achieved and controller-contribution wire fields.
- [ArduCopter transmitter-based tuning](https://ardupilot.org/copter/docs/common-transmitter-tuning.html)
  — existing advanced in-flight manual tuning precedent and parameter groups.
- [ArduCopter tuning setup](https://ardupilot.org/copter/docs/setting-up-for-tuning.html)
  — prerequisites, filter relationships, and instability hazards outside the PID
  values themselves.
- [ArduCopter AutoTune](https://ardupilot.org/copter/docs/autotune.html)
  — pilot escape, original/tuned gain handling, test sequencing, and save model.
- [ArduPlane tuning quickstart](https://ardupilot.org/plane/docs/tuning-quickstart.html)
  — distinct Plane controller model and immediate/persistent parameter-editing
  precedent; it must not be inferred from Copter behavior.
- [ArduPilot onboard-log analysis](https://ardupilot.org/copter/docs/common-downloading-and-analyzing-data-logs-in-mission-planner.html)
  — control/PID log evidence for post-flight analysis.

## Explicit non-goals for the first milestone

- A generic unrestricted parameter editor.
- Automatic gain selection or a replacement for ArduPilot AutoTune.
- Automatic rollback triggered by browser-side telemetry heuristics.
- In-flight writes enabled by the ordinary parameter-write feature flag.
- Treating Copter, Plane, traditional helicopter, or other vehicle controllers
  as interchangeable because they all contain P/I/D terms.
- Claiming flight readiness from SITL alone.
