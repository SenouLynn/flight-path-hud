# Heading Indicator

Shows yaw — the direction the nose is pointing, compass-referenced. Implemented in
[src/logic/heading.ts](../apps/hud/src/logic/heading.ts) and rendered by
[HudHeadingIndicator.tsx](../apps/hud/src/components/HudHeadingIndicator.tsx).

## MAVLink source options

| Source | Msg | Field | Type | Units | Notes |
|--------|-----|-------|------|-------|-------|
| **VFR_HUD.heading** (primary) | #74 | `heading` | int16 | deg (0–360) | Ground-course-corrected magnetic heading, already display-ready. What most HUDs use. |
| **ATTITUDE.yaw** (fallback 1) | #30 | `yaw` | float | rad (−π…π) | Raw EKF yaw estimate; not necessarily magnetic-corrected. Converted to degrees. |
| **GLOBAL_POSITION_INT.hdg** (fallback 2) | #33 | `hdg` | uint16 | centideg (÷100) | Vehicle heading. Reports `65535` (`UINT16_MAX`) when unknown — must be rejected. |

GPS course-over-ground (`GPS_RAW_INT.cog`, #24, centideg) is **track**, not nose-heading,
and is handled by the flight-path logic, not here. See
[flight_path_marker.md](./flight_path_marker.md).

## Algorithm: `resolveHeading(sample)`

A **priority fallback chain**. The first source present (after sanitization) wins, and the
result records which one was used plus an `isFallback` flag:

1. `VFR_HUD.heading` → normalize to 0–360 → `source: 'VFR_HUD.heading'`, `isFallback: false`.
2. else `ATTITUDE.yaw` → `yawRadiansToHeadingDegrees` (rad→deg then wrap) → `isFallback: true`.
3. else `GLOBAL_POSITION_INT.hdg` → reject `65535`, else `/100` and normalize → `isFallback: true`.
4. else `{ headingDeg: null, source: 'none', isFallback: false }`.

Key helpers:

- `normalizeHeadingDegrees(x)` — wraps any degree value into `[0, 360)` (handles negatives
  and values like `370 → 10`).
- `yawRadiansToHeadingDegrees(yawRad)` — `yaw * 180/π`, then normalized. A yaw of `−π/2`
  becomes `270°`.
- `UNKNOWN_GLOBAL_HEADING_VALUE = 65535` — the sentinel that maps to "no heading".

Returned shape (`HeadingResolution`): `{ headingDeg: number | null, source, isFallback }`.

## Rendering (`HudHeadingIndicator`)

- A horizontal **scrolling tape** centered on current heading, `±70°` visible.
- `pixelsPerDegree = width / 120`; minor ticks every 5°, major (labeled) every 10°.
- `shortestDeltaDegrees` places each tick relative to center, correctly wrapping across the
  0/360 seam so the tape scrolls continuously.
- Cardinal ticks render as `N/E/S/W`; others as zero-padded 3-digit bearings.
- A center bug + numeric readout show the exact current heading.

## Validation

`HEADING_VALIDATION_FRAMES` in [replay.ts](../apps/hud/src/logic/replay.ts) covers: VFR primary,
wrap (`370 → 10`), ATTITUDE fallback (`−π/2 → 270`), GLOBAL centideg (`12345 → 123.45`),
and the unknown sentinel (`65535 → null`). Unit tests live in
[heading.test.ts](../apps/hud/src/logic/heading.test.ts).
