# Attitude and Horizon Indicator

The artificial horizon: shows **pitch** (nose up/down) and **roll** (bank) together, plus a
3D orientation view. Pitch moves the horizon line up/down; roll tilts it.

## MAVLink sources

| Quantity | Msg | Field | Type | Units |
|----------|-----|-------|------|-------|
| Roll  | ATTITUDE (#30) | `roll`  | float | rad |
| Pitch | ATTITUDE (#30) | `pitch` | float | rad |
| Yaw   | ATTITUDE (#30) | `yaw`   | float | rad |
| Pitch rate | ATTITUDE (#30) | `pitchspeed` | float | rad/s |
| Yaw rate | ATTITUDE (#30) | `yawspeed` | float | rad/s |

All attitude angles arrive in **radians** and are converted to degrees for display.

## Algorithm (logic): `resolveAttitude` + `computeHorizonTransform`

Implemented in [src/logic/attitude.ts](../apps/web/src/logic/attitude.ts). This is the *canonical*
transform used by the replay-preview horizon.

### `resolveAttitude(sample) → { pitchDeg, rollDeg, hasAttitude }`

- Requires **both** pitch and roll to be present; otherwise `hasAttitude: false` and both
  degrees are `null` (see the `attitude-missing-values` validation frame).
- `pitchDeg = pitchRad * 180/π`.
- `rollDeg = normalizeRollDegrees(rollRad * 180/π)` — wraps roll into `(−180, 180]` so a
  bank reads as a signed angle rather than 0–360.

### `computeHorizonTransform(sample, config) → HorizonTransform | null`

Turns attitude into the two endpoints of the horizon line in screen space:

1. Clamp pitch to `±maxPitchDegrees` (default 30°).
2. **Pitch → vertical offset:** `pitchOffsetPx = clampedPitch × pixelsPerDegree × dir`,
   where `dir = +1` when `pitchPositiveMovesDown` is true. Default `pixelsPerDegree = 6`,
   so 10° pitch = 60 px.
3. **Roll → rotation:** build a horizontal line at that offset
   (`±lineHalfWidthPx`, default 80) and rotate both endpoints by the roll angle using a
   standard 2D rotation matrix (`rotatePoint`).

Config (`DEFAULT_HORIZON_CONFIG`): `pixelsPerDegree: 6`, `lineHalfWidthPx: 80`,
`maxPitchDegrees: 30`, `pitchPositiveMovesDown: true`.

**Algorithm name:** this is the classic *pitch-ladder displacement + roll rotation*
model — pitch is a linear vertical translation (px-per-degree), roll is a rigid 2D
rotation of the horizon about screen center.

## Rendering (component): `HudAttitudeIndicator`

[HudAttitudeIndicator.tsx](../apps/web/src/components/HudAttitudeIndicator.tsx) renders the live HUD
independently of the logic transform above:

- Sky/ground rects + horizon line inside a clipped window.
- SVG transform: `translate(cx, cy) rotate(-rollDeg) translate(0, pitchOffset)` with
  `pitchOffset = clamp(pitch, ±30) × 6`.
- Pitch ladder at `±10/20/30°`, a fixed roll arc with tick marks at
  `0/±10/±20/±30/±45/±60°`, a center bug, and a fixed aircraft reference symbol.

> ⚠️ **Two implementations, two sign conventions.** The component uses `rotate(-rollDeg)`
> and its own pitch-offset sign; the logic module uses `rotatePoint(+rollRad)` and a
> `pitchPositiveMovesDown` flag. They are defined separately, so the live HUD and the
> replay preview can invert relative to each other. This is the "rendering is inverted in
> some places" issue from commit `355baff`. The clean fix is to have the component consume
> `computeHorizonTransform` directly. See [architecture.md](./architecture.md#known-issues).

## 3D orientation view: `HudOrientationIndicator`

[HudOrientationIndicator.tsx](../apps/web/src/components/HudOrientationIndicator.tsx) draws a
wireframe vehicle model in a perspective projection:

- Applies the **aircraft Euler rotation sequence** roll→pitch→yaw as intrinsic rotations
  about X, Y, Z respectively (`applyAttitude = rotateZ(rotateY(rotateX(...))))`.
- Projects to 2D with a simple pinhole/perspective divide (`projectTo2d`, focal length 250,
  depth bias 140).
- Shows body axes (X/Y/Z + Down), a sky/ground reference disc with N/S/E/W, and HDG/pitch/
  roll readouts. Yaw drives the heading label.

## Validation

`ATTITUDE_VALIDATION_FRAMES` in [replay.ts](../apps/web/src/logic/replay.ts): level flight,
+10° pitch (→ 60 px), +30° roll, combined down-pitch/left-roll, and a missing-roll frame
that must resolve to `null`. Unit tests: [attitude.test.ts](../apps/web/src/logic/attitude.test.ts).
