# Planning handoff — mixed-SITL motion scenario

**Date:** 2026-08-13  
**Purpose:** Plan the next validation milestone without reopening browser command
authority or repeating the completed stationary mixed-SITL acceptance work.

## Starting point

The stationary Docker acceptance scenario has passed with real ArduPilot 4.6.2:

- ArduCopter is `1:1`; ArduPlane is `2:1`.
- Both systems maintain independent telemetry, positions, missions and map state.
- Mission pulls return three Copter items and four Plane items in either order.
- Plane-only stop/restart produces stale state, 60-second browser eviction and
  automatic recovery without a browser reload.
- A short real-SITL recording replays both systems and passively reconstructs
  both mission overlays without emitting MAVLink.

The existing `npm run gcs:sitl` scenario is deliberately stationary and
read-only. Preserve it as the regression/acceptance baseline; do not turn it into
the motion scenario.

## Goal of the next scenario

Add a separate, explicitly test-only workflow that makes both real ArduPilot
vehicles move enough to exercise:

- independent geographic trails and ENU epochs;
- changing heading, ground speed, altitude and attitude instruments;
- simultaneous fleet-map updates without system or mission crossover;
- capture/replay parity for the resulting moving telemetry; and
- clean stop/reset behavior with no persistent SITL state leaking into the next
  run.

This remains bridge/presentation validation, not an airworthiness or control-UX
claim.

## Authority boundary

Do not add arm, mode or mission-start controls to the browser for this milestone.
Use a versioned test-only controller or explicit MAVProxy workflow that is:

- enabled only for the Docker SITL environment;
- target-explicit for every `sysId:compId`;
- incapable of falling back to the most recent sender;
- visibly separate from the production bridge WebSocket command surface; and
- responsible for restoring/stopping both simulations after the scenario.

The browser remains an observer plus its existing read-only mission-download
request. General command envelopes, confirmation UX, allowlists and field safety
belong to `mavlink_command_validation.md` after this milestone.

## Planning decisions to make first

1. **Motion mechanism.** Prefer uploaded missions plus explicit mode/arm/start
   through a test controller, or use Guided commands if that produces a smaller,
   more deterministic scenario. Decide separately for Copter and Plane; their
   arming, takeoff and Guided/AUTO semantics are not interchangeable.
2. **Scenario topology.** Choose nearby but separated routes around CMAC so both
   remain visible at fleet-map scale and never intentionally converge.
3. **Completion signal.** Define machine-observable success per vehicle, such as
   armed state, expected mode, minimum displacement, waypoint progress and final
   disarm/stop state. Wall-clock sleep alone is not acceptance evidence.
4. **Failure policy.** Specify timeouts and immediate cleanup for failure to arm,
   establish GPS/EKF readiness, change mode, take off, advance the mission or
   maintain separation.
5. **Recording scope.** Use an explicitly named, tightly capped capture. Preserve
   only a minimized, sanitized fixture containing the telemetry needed for motion
   assertions.

## Suggested acceptance evidence

For each system independently:

- Position moves by a configured minimum distance from its initialized CMAC fix.
- Trail gains multiple nonduplicate `GLOBAL_POSITION_INT` points without a false
  long-distance startup segment.
- Heading and ground speed change coherently with position; altitude/attitude
  change where the chosen vehicle scenario requires them.
- The other system's state, trail and mission never appear under this scope.

For the mixed fleet:

- Both markers update concurrently and remain distinguishable.
- Routes remain separated by the planned safety margin.
- Stopping the controller or scenario leaves no vehicle unexpectedly armed or in
  an active autonomous mode.
- A sanitized capture reproduces the same normalized per-system motion and trail
  behavior in replay.

## Useful implementation seams

- Keep Docker orchestration under `apps/mavlink-bridge/sitl/`, but give motion a
  separate Compose profile, override or script rather than changing the default
  stationary command.
- Reuse the existing CMAC location, seeded mission files, source-route mapping,
  recorder and replay adapter.
- Put controller protocol/state logic behind a testable module; keep process and
  Docker plumbing at its edge.
- Reuse the existing `GLOBAL_POSITION_INT`-only trail advancement and 1 km epoch
  reset behavior as assertions, not as movement generation.

## Explicit non-goals

- Browser command/control UI.
- RC override or unrestricted raw MAVLink injection.
- Formation keeping, collision avoidance or swarm coordination.
- Hardware, bench or field validation.
- Replacing real ArduPilot motion with synthetic position injection.

After this scenario passes, return to the staged command foundation in
`mavlink_command_validation.md` before exposing any write authority in the GCS.
