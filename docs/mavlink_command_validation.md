# MAVLink Command Validation Roadmap

The browser GCS is deliberately receive-only today, except for explicit mission download.
That boundary remains in force for field-connected systems. The mixed ArduCopter +
ArduPlane SITL stack is the future validation environment for carefully expanding from
observation to command-capable workflows.

ArduPilot supports MAVLink communication with both ground stations and companion
computers, but its command surface is not one uniform API: Guided-mode behavior, mission
commands, supported messages, and parameters vary by vehicle type. Start developer-facing
integration questions with ArduPilot's [GCS Resources](https://ardupilot.org/dev/docs/gcs-resources.html),
then use its [MAVLink Interface documentation](https://ardupilot.org/dev/docs/mavlink-commands.html)
and the relevant Copter and Plane pages for a concrete command family.

## ArduPilot GCS resources

Treat ArduPilot's GCS Resources page as the source index for GCS-facing metadata:

- **Parameter metadata** supplies descriptions, ranges, and related information. A future
  parameter UI must retrieve/version this metadata rather than hard-code parameter labels
  or safe ranges.
- **Onboard-log metadata** is useful for future log inspection, but is distinct from the
  bridge's sanitized MAVLink recording format.
- **Firmware manifest** is relevant only if this project later manages firmware discovery
  or update workflows; it is not part of the current GCS or SITL scope.
- **SRTM data** remains an autopilot/terrain-data concern, not the chosen provider for a
  browser 3D map. See [terrain_and_3d_map_notes.md](./terrain_and_3d_map_notes.md).

## Onboard Lua scripting: constrained fallback

ArduPilot's [Lua scripting](https://ardupilot.org/dev/docs/common-lua-scripts.html)
can add onboard behavior without modifying core flight code. It is a viable fallback when
a required vehicle-local integration cannot be expressed cleanly through the GCS/companion
MAVLink interface—for example, a narrowly scoped sensor, peripheral, or vehicle-local
automation integration.

It is **not** the preferred implementation path for ordinary GCS controls, nor a substitute
for the bridge's command policy. Lua scripts run from the autopilot's SD card (or SITL
working directory), can manipulate vehicle state and issue MAVLink commands, and consume
finite controller memory. Therefore, any adopted script must have:

- a versioned source and declared vehicle/firmware compatibility;
- a documented capability, trigger inputs, and explicit operator-visible status;
- SITL tests for normal, missing-script, script-error, and restart behavior;
- resource-budget verification on target hardware; and
- checksum/pre-arm policy considered before field use, so a missing or changed script does
  not silently alter the intended vehicle configuration.

The GCS should surface a script's reported health/status where useful, but must not assume
that it can inspect, approve, or safely override arbitrary onboard Lua behavior.

## Roles and authority boundaries

| Role | Near-term responsibility | Authority rule |
| --- | --- | --- |
| Browser GCS | Observe, inspect, replay, and later request explicitly confirmed actions | Must not gain implicit control authority from merely receiving telemetry. |
| MAVLink bridge | Decode, route, record, and eventually relay only allowlisted commands | Routes by target system/component; never uses a last-sender fallback. |
| SITL fleet | Safe, repeatable protocol-validation target | Required before a command family reaches bench or aircraft tests. |
| ESP32 HUD | Consume onboard MAVLink telemetry and render the unified HUD in the FPV camera optical path | Read-only display client; it has no command/control responsibility in this project. |

The ESP32 HUD is a side project that shares telemetry concepts and display logic with the GCS,
not the GCS command path. Its default input is onboard MAVLink telemetry and its output is a
small fixed-reference display for FPV. It should stay read-only, tolerate absent/stale data,
and never be required for flight control.

If a distinct future project elects to make another onboard computer a MAVLink companion,
that capability must be designed separately with its own identity, allowlist, interlocks, and
loss-of-link behavior. Do not turn the ESP32 HUD into a transparent proxy for browser control.

## Staged expansion

### 0. Command foundation — before any write action

Implemented on the `multi-node-figure8` branch with an intentionally empty
production allowlist. The bridge now validates and normalizes command envelopes,
binds sends/retries/acknowledgements to an exact target route, rejects replay and
stale routes, records lifecycle events, and passively reconstructs them in replay.
No browser command UI or operational command family is enabled yet.

- Add a command envelope containing request ID, target `sysId:compId`, command family,
  actor, timestamp, and explicit confirmation state.
- Maintain a per-command allowlist and reject replay-originated commands.
- Record request, transmitted MAVLink packets, `COMMAND_ACK`/protocol result, timeout, and
  final normalized status in the existing recording/replay format.
- Route every packet, retry, and acknowledgement to the requested system's known endpoint.
- Require an independent test for the same target-routing and stale-route failure behavior
  already used by mission download.

### 1. Read-only protocol coverage

In progress: the first slice implements target-routed single-parameter reads by
name or index using a transport-neutral transaction state machine. `PARAM_VALUE`
responses, retries, timeouts, recording, and passive replay are correlated to the
request and exact vehicle. No parameter writes or browser controls are included.

Validate parameter reads, message/data-stream requests, home/EKF-origin reads where
applicable, and expanded mission download. These confirm request/response correlation
without changing vehicle state.

### 2. Reversible, low-consequence SITL actions

The first action is validated: a Docker-SITL-only `LOG_DISARMED` boolean write.
It requires explicit confirmation, exact-target routing, bounded values, returned
`PARAM_VALUE`, independent read-back, cross-target isolation, and unconditional
restoration of the original values. A sanitized lifecycle fixture proves passive,
deterministic replay without outbound packets. The production feature flag remains
off; no browser write control exists.

Behind an explicit SITL-only feature flag, validate small parameter writes and camera/gimbal
commands when supported. Confirm the returned acknowledgement and the subsequent telemetry
or parameter state. Reset the simulator state between scenarios.

### 3. Mission write transaction

Validated in mixed ArduCopter + ArduPlane SITL: portable numeric codecs and a transport-neutral replacement
state machine now cover `MISSION_CLEAR_ALL`, `MISSION_COUNT`, vehicle-driven
`MISSION_REQUEST_INT`/`MISSION_ITEM_INT`, final `MISSION_ACK`, bounded retries, exact-target
correlation, and independent read-back comparison. A disabled-by-default policy/router
boundary adds explicit confirmation, a fixed clear-then-replace policy, per-target
serialization, lifecycle recording/replay, and automatic read-back. No browser control
exists. The acceptance controller proved per-target replacement, independent
read-back, peer isolation, and unconditional restoration of both original missions.
MAVLink 1 legacy `MISSION_REQUEST`/`MISSION_ITEM` negotiation is supported alongside
`MISSION_REQUEST_INT`/`MISSION_ITEM_INT`, with bounded coordinate tolerance only for
the legacy float representation.
A sanitized 67-event lifecycle fixture preserves deterministic, transmit-free
replay evidence for all six accepted transactions without retaining mission content.

Implement mission upload as a complete transaction: clear/replace policy, item count,
ordered item transfer, timeout/retry behavior, final acknowledgement, and read-back
comparison. Test Copter and Plane missions separately; do not infer cross-vehicle support
from shared message names.

### 4. Mode, arm, and Guided-mode operations

Foundation in progress: HEARTBEAT decoding now retains portable numeric
`base_mode`, `custom_mode`, vehicle/autopilot type, and system status, plus the
standard armed bit. A per-target freshness tracker refuses to use stale state.
Vehicle-specific mode interpretation remains explicit rather than inferred.
A disabled-by-default mode transaction consumes this state with explicit confirmation,
fresh and disarmed preconditions, exact-target ACK correlation, and HEARTBEAT
post-condition verification. The initial allowlists contain only Copter
`STABILIZE`/`LOITER` and Plane `MANUAL`/`LOITER`. Mixed-SITL acceptance passed
with both vehicles disarmed, target-isolation checks, and restoration to each
vehicle's original custom mode. Guided operations remain.
A sanitized 12-event lifecycle fixture deterministically replays all four accepted
mode transitions without outbound traffic.

Arm/disarm is validated in isolated mixed Copter/Plane SITL. It has
dual feature/environment gates, requires an exact `sitl-no-propulsion` safety case,
fresh supported ArduPilot state, explicit operator metadata and confirmation, and
correlates both ACK and the HEARTBEAT armed bit. Forced arm/disarm is impossible in
the codec and arming has no retry by default. The acceptance controller proved
standard arming, exact-target peer isolation, immediate verified disarm, and final
disarmed cleanup for both vehicles. It remains dual-gated with no browser or
non-SITL enablement. A sanitized 12-event fixture deterministically replays the
four accepted arm/disarm lifecycles, including ACK and armed-state observation,
without transmitting MAVLink. Live Guided operations remain unimplemented.

The first Guided operation is registered exclusively behind a feature gate plus
the isolated-SITL environment gate. A pure policy prepares position-only
`MAV_CMD_DO_REPOSITION` encoded as `COMMAND_INT` in
`MAV_FRAME_GLOBAL_RELATIVE_ALT_INT`. It
requires fresh supported ArduPilot identity, an already-armed vehicle already in
the correct vehicle-specific Guided custom mode (Copter `4`, Plane `15`), operator
identity and confirmation, an isolated-SITL attestation, and a caller-supplied
latitude/longitude/relative-altitude safety envelope. Plane additionally requires
an explicit loiter radius and direction bounded by that envelope, while Copter
rejects those Plane-only controls. The command never requests an implicit mode
change. The transaction requires an exact-target successful ACK plus normalized
`GLOBAL_POSITION_INT` within explicit horizontal and relative-altitude tolerances;
it fails if the target disarms, leaves Guided mode, loses its route, or times out,
and defaults to zero retries. Separate live ArduPilot 4.6.2 SITL acceptance passed:
Copter moved 22.9 m into its bounded arrival volume and Plane moved 194.3 m into
its larger loiter arrival volume; both commands received successful ACKs, the peer
remained armed in its own Guided mode, and cleanup disarmed both simulators. No
browser or non-SITL enablement exists.
A sanitized six-event lifecycle fixture retains both successful transactions and
their distinct Copter/Plane policy fields, successful ACKs, and horizontal plus
relative-altitude arrival measurements. Regression tests replay it deterministically
without emitting MAVLink.

These are state-changing and potentially safety-critical. Add only after a command policy,
operator confirmation UX, target identity display, current-mode/armed-state verification,
and negative tests are in place. Guided-mode actions require distinct Copter and Plane SITL
scenarios because their command semantics differ.

### 5. Bench, then aircraft

Graduate one command family at a time from SITL to a non-propulsive bench setup, then to a
controlled aircraft test. A command must be disabled by default outside the selected
validation environment until it has passed its evidence gate.

## Required acceptance evidence per command family

1. The command reaches only its selected system in the mixed fleet.
2. A rejected, stale, unsupported, or unknown target sends no packet to another vehicle.
3. The expected acknowledgement/result is correlated with the request ID and target.
4. The expected post-condition is observed in telemetry or a read-back query.
5. Timeout, retry, disconnect, duplicate request, and simulator restart behavior are tested.
6. A sanitized recording replays the normalized command-status sequence deterministically.
7. Copter and Plane outcomes are asserted independently where they differ.

## Non-goals for the first command milestone

- Browser flight control, RC override, or unrestricted raw MAVLink injection.
- Automatic promotion from SITL to a real connected vehicle.
- Turning the ESP32 HUD into a companion-computer control path.
- Assuming a MAVLink message is accepted equally by all ArduPilot vehicle classes.
