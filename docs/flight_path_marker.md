# FPM + BAI — Flight Path Marker & Bank Attitude Indicator

The **velocity vector**: where the aircraft is *actually going right now* — fusing heading,
wind drift, and vertical speed — as opposed to where the nose points. This is the
circle-with-wings symbol that floats above/below the horizon in real HUDs.

Two logic modules back this:

- [src/logic/flightPath.ts](../apps/hud/src/logic/flightPath.ts) — instantaneous vectors + a
  kinematic predictive path (linear vs turn-aware).
- [src/logic/trajectory.ts](../apps/hud/src/logic/trajectory.ts) — a richer integrated trajectory
  that blends heading/track/bank/pitch, used by the on-screen predictive view.

## MAVLink sources

| Quantity | Msg | Field(s) | Type | Units | Notes |
|----------|-----|----------|------|-------|-------|
| Velocity vector | GLOBAL_POSITION_INT (#33) | `vx, vy, vz` | int16 | cm/s | **NED** frame (North, East, Down). Primary source. |
| Ground speed | VFR_HUD (#74) | `groundspeed` | float | m/s | Display-ready scalar. |
| Climb rate | VFR_HUD (#74) | `climb` | float | m/s | **Positive-up.** |
| Ground track / speed | GPS_RAW_INT (#24) | `cog, vel` | uint16 | cdeg, cm/s | 2D-only fallback / cross-check. |
| Turn rate | ATTITUDE (#30) | `yawspeed` | float | rad/s | Curves the turn-aware projection. |

**NED sign convention:** `vz` is positive **down**, but climb is reported positive **up**,
so vertical speed is derived as `-vz`. Watch this everywhere velocity touches altitude.

## Instantaneous resolvers (`flightPath.ts`)

### `resolveScalarTelemetry` — ground speed & climb, with provenance

Fallback chains, each recording its `source`:

- **Speed:** `VFR_HUD.groundspeed` → `√(vx²+vy²)` from GLOBAL_POSITION_INT → `GPS_RAW_INT.vel`.
- **Climb:** `VFR_HUD.climb` → `-vz` from GLOBAL_POSITION_INT.
- Also emits knots via `mpsToKnots` (`× 1.943844`).

### `resolveFlightPath2d` — ground track (2D)

- **Track angle** = `atan2(vy, vx)` normalized to 0–360. In the NED frame this is the true
  direction of travel over the ground.
- Below `STATIONARY_EPSILON_MPS` (0.01 m/s) track is `null` (`isValid: false`) — you can't
  define a direction when not moving.
- Falls back to `GPS_RAW_INT.cog/vel` if velocity components are absent.

### `resolveFlightPath3d` — flight path angle (vertical)

- **Flight Path Angle (FPA)** = `atan2(verticalSpeed, horizontalSpeed)` in degrees, where
  `verticalSpeed = -vz` and `horizontalSpeed = √(vx²+vy²)`.
- This is the vertical component of the FPM — how far above/below the horizon the velocity
  vector sits. Positive = climbing.

### `resolvePredictivePath` — kinematic forward projection

Projects the ground track forward over a horizon (default 5 s, 0.5 s steps) two ways:

- **Linear:** `position(t) = velocity × t`. Cheap, correct in straight flight, diverges in
  turns.
- **Turn-aware (CTRV):** a **Constant Turn Rate and Velocity** model. Given initial track
  `θ₀ = atan2(vy, vx)`, speed `V`, and yaw rate `ω` (`ATTITUDE.yawspeed`), the arc is:

  ```
  north(t) =  (V/ω)·[ sin(θ₀ + ω·t) − sin(θ₀) ]
  east(t)  = −(V/ω)·[ cos(θ₀ + ω·t) − cos(θ₀) ]
  ```

  When `|ω|` is below `YAW_RATE_EPSILON_RAD_PER_SEC` it degenerates to the straight-line
  case (avoiding division by ~0). `source` reports
  `'GLOBAL_POSITION_INT+ATTITUDE.yawspeed'` vs `'GLOBAL_POSITION_INT.linear'`.

## Integrated trajectory (`trajectory.ts`)

`resolvePredictiveTrajectory` produces the richer path drawn by
[HudPredictiveTrajectory](../apps/hud/src/components/HudPredictiveTrajectory.tsx). It pulls scalar,
attitude, heading, and 2D-track resolutions together and **step-integrates** a path in
screen-relative (lateral, forward, climb) space. Key model pieces:

- **Heading/track blend** — `worldDirectionRad` blends nose heading toward ground track
  (`blendAnglesRadians` over the shortest angular path), weighted more toward track as
  speed rises above stall. This is what makes the marker show *drift*.
- **Wind drift** — `windDriftMps = clamp(speed · sin(heading−track) · windOffsetGain, ±8)`;
  the lateral crab induced by the heading/track difference.
- **Coordinated-turn bank rate** — `bankTurnRate = g·tan(roll) / max(speed, stall)`. This
  is the standard **coordinated (level) turn** relation ω = g·tan(φ)/V. It is added to the
  measured `yawspeed` and clamped to `±1.8 rad/s`.
- **Vertical rate** — `speed · sin(pitch) + climb`.
- **Stall handling** — below `stallSpeedMps` (default 14) `isStalled` is set; forward
  progress uses `max(0, speed − stall)` so the marker collapses toward the origin, and the
  component shows a "BELOW STALL" cue.

Config (`DEFAULT_TRAJECTORY_CONFIG`): `stallSpeedMps: 14`, `horizonSec: 5`, `stepSec: 0.25`,
`headingTrackBlend: 0.45`, `windOffsetGain: 0.32`, `GRAVITY_MPS2 = 9.81`.

Output includes the integrated `points[]`, plus `turnRateRadPerSec`, `verticalRateMps`,
`headingDeg`, `trackDeg`, `driftDeg` / `headingTrackDeltaDeg`, `windDriftMps`, `isStalled`.

## Named algorithms & references

- **Velocity vector / Flight Path Marker (FPM)** — HUD symbology fusing track + FPA.
- **Ground track** = `atan2(vy, vx)` in the NED frame.
- **Flight Path Angle** = `atan2(-vz, √(vx²+vy²))`.
- **CTRV** (Constant Turn Rate and Velocity) — the turn-aware arc projection.
- **Coordinated turn** — bank-to-turn-rate relation `ω = g·tan(φ) / V`.

## Validation

`FLIGHT_PATH_VALIDATION_FRAMES` in [replay.ts](../apps/hud/src/logic/replay.ts) pins expected track,
speed, climb, FPA, and both linear and turn-aware 5 s endpoints — including a GPS-only
fallback frame and a stationary frame that must invalidate the track. Unit tests:
[flightPath.test.ts](../apps/hud/src/logic/flightPath.test.ts) and
[trajectory.test.ts](../apps/hud/src/logic/trajectory.test.ts).
