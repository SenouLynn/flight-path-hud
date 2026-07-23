# Architecture Decision Records (ADR)

A living log of architecturally significant decisions for the HUD validation harness.
It exists so humans **and** AI agents can understand *why* the system is shaped the way it
is, not just *what* the code does.

## How to use this document

- **One entry per decision**, newest at the top of the log, numbered `ADR-NNNN`.
- Entries are **append-mostly**. Once a decision is `Accepted`, don't rewrite its history —
  if it changes, add a **new** ADR and set the old one's status to
  `Superseded by ADR-NNNN`.
- Keep entries **short and concrete**: the context that forced a choice, the choice, and
  the consequences (good and bad).
- Cross-link to code with repo-relative paths and to other ADRs by number.

### When to add an ADR (agents: read this)

Add one when a change would make a future reader ask "why was it done this way?":
choosing/dropping a dependency, a data-flow or module-boundary decision, a numerical or
sign convention, a fallback-priority order, a public type/interface contract, or a
deliberate trade-off (simplicity vs accuracy, etc.). Do **not** add ADRs for routine bug
fixes, refactors that preserve behavior, or cosmetic changes — those belong in
[CHANGELOG.md](../CHANGELOG.md).

### Entry template

```markdown
## ADR-NNNN: <short title>

- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD
- **Deciders:** <names / "team">

### Context
What situation or constraint forced a decision? What are we optimizing for?

### Decision
What we chose to do, stated plainly.

### Consequences
- ✅ Positive outcomes / what this unlocks.
- ⚠️ Costs, risks, or follow-ups this creates.

### Alternatives considered
- <option> — why not.
```

---

## Log

The entries below were reconstructed from the initial implementation (commits `9315edc`,
`355baff`) and documented on 2026-07-23. Dates reflect when each decision was first made in
the code.

## ADR-0001: HUD logic as pure, framework-free resolvers

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** team

### Context
The end target is an ESP32 firmware HUD (the README's "translate into C++" goal). We need
to iterate on the math quickly in a rich UI, but the math must not get entangled with React
or the browser or it won't be portable.

### Decision
All HUD math lives in pure functions under [src/logic/](../src/logic/), each of the form
`resolveX(sample) → resolution`. No React, I/O, or globals. Components and the replay
harness are the only callers.

### Consequences
- ✅ Logic is unit-testable in isolation and mechanically portable to C++.
- ✅ The same resolvers drive both the live feed and the validation tables.
- ⚠️ Rendering components that re-implement any logic (see ADR-0006) can silently diverge
  from the canonical resolver.

### Alternatives considered
- Logic inside components — faster to write, but not portable and hard to validate.

## ADR-0002: Sanitize telemetry at the boundary

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** team

### Context
Real MAVLink streams carry missing fields, `NaN`, and `Infinity`. Every resolver otherwise
has to re-check validity, and a stray `NaN` silently poisons trig math.

### Decision
`sanitizeTelemetrySample` in [telemetry.ts](../src/logic/telemetry.ts) coerces any
non-finite/non-number to `undefined` and drops all-empty sub-objects, run once at the top of
every resolver. Downstream code branches only on "present and finite" vs "absent".

### Consequences
- ✅ Resolvers stay simple; `undefined` is the single "no data" signal.
- ⚠️ Slight redundant work when multiple resolvers sanitize the same sample.

## ADR-0003: Provenance via a `source` field on every resolution

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** team

### Context
Several quantities (heading, ground speed, track) can come from more than one MAVLink
message. We need to know which field actually produced a displayed value — both to debug
and to decide which fields the firmware must guarantee.

### Decision
Every resolution object carries a `source` (and where relevant an `isFallback`) string
enum naming the exact MAVLink field used, e.g. `'VFR_HUD.heading'` vs `'ATTITUDE.yaw'`.

### Consequences
- ✅ Data lineage is visible in the UI and assertable in tests.
- ✅ Directly informs firmware field-priority requirements.
- ⚠️ Adding a new source means extending the union types in step.

## ADR-0004: Heading source priority — VFR_HUD → ATTITUDE.yaw → GLOBAL_POSITION_INT.hdg

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** team

### Context
Heading is available from three messages with different units and reliability. We want the
most display-ready, magnetic-corrected source first.

### Decision
Resolve in order: `VFR_HUD.heading` (deg, primary) → `ATTITUDE.yaw` (rad→deg fallback) →
`GLOBAL_POSITION_INT.hdg` (centideg, rejecting the `65535` unknown sentinel). See
[heading.ts](../src/logic/heading.ts) and [heading_indicator.md](./heading_indicator.md).

### Consequences
- ✅ Avoids radian conversion in the common case; degrades gracefully.
- ⚠️ Fallback sources may not be magnetic-corrected; `isFallback` flags this.

## ADR-0005: NED velocity with explicit sign flips for climb and FPA

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** team

### Context
MAVLink `GLOBAL_POSITION_INT.vz` is positive **down** (NED), but climb rate and flight path
angle are conventionally positive **up**. Getting this wrong inverts vertical cues.

### Decision
Derive vertical speed as `-vz`; compute track as `atan2(vy, vx)` and FPA as
`atan2(-vz, √(vx²+vy²))`. Centralized in [flightPath.ts](../src/logic/flightPath.ts).

### Consequences
- ✅ One documented place for the NED→display sign convention.
- ⚠️ Any new velocity consumer must remember the flip; called out in the docs.

## ADR-0006: Turn-aware predictive path uses a CTRV model

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** team

### Context
Straight-line velocity extrapolation looks visibly wrong while the aircraft banks into a
turn. We have turn rate available (`ATTITUDE.yawspeed`).

### Decision
Project the path with a **Constant Turn Rate and Velocity (CTRV)** arc, degrading to the
linear model when `|yawspeed|` is negligible. A richer integrated variant in
[trajectory.ts](../src/logic/trajectory.ts) additionally blends heading/track and adds a
coordinated-turn bank term `ω = g·tan(φ)/V`. See
[flight_path_marker.md](./flight_path_marker.md).

### Consequences
- ✅ Projected path curves realistically during turns.
- ⚠️ CTRV assumes constant speed and turn rate over the horizon; only valid for short
  lookaheads (default 5 s).

## ADR-0007: Known-answer replay harness as the validation surface

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** team

### Context
We need confidence the math is right before firmware translation, and a way to eyeball
regressions.

### Decision
[replay.ts](../src/logic/replay.ts) holds hand-derived expected values for synthetic
frames; `App.tsx` renders expected-vs-resolved-vs-error tables, and Vitest suites assert the
same properties. Errors should read `0.000000` or `N/A`.

### Consequences
- ✅ Regressions are visible both in CI (Vitest) and in the running app.
- ⚠️ Expected values are computed by hand and must be updated deliberately when a model
  intentionally changes.

## ADR-0008: [OPEN] Duplicate attitude transform in component vs logic

- **Status:** Proposed
- **Date:** 2026-07-22
- **Deciders:** team

### Context
[HudAttitudeIndicator.tsx](../src/components/HudAttitudeIndicator.tsx) re-implements the
pitch/roll→screen transform instead of consuming `computeHorizonTransform` from
[attitude.ts](../src/logic/attitude.ts). The two define sign conventions independently, so
the live HUD and the replay preview can invert relative to each other — the "rendering is
inverted in some places" issue from commit `355baff`. This violates the single-source
principle of ADR-0001.

### Decision
*(Proposed)* Have the component consume the canonical `computeHorizonTransform` so there is
one sign convention. Not yet implemented.

### Consequences
- ✅ Would eliminate the inversion class of bugs.
- ⚠️ Requires reconciling the component's SVG transform math with the logic module's
  endpoint-rotation model and re-verifying against the attitude replay frames.

## ADR-0009: Orientation indicator — aerospace body frame + fixed chase camera

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
The 3D orientation panel ([HudOrientationIndicator.tsx](../src/components/HudOrientationIndicator.tsx))
cross-wired roll and pitch: its vehicle vertices were authored with the nose along **+Y**,
but the rotation code applied roll about **X** and pitch about **Y** as if the nose were
along **+X** (standard aerospace). A `roll` input therefore drove a pitch-looking motion and
vice-versa. The abstract wireframe plus an X/Y/Z/D axis triad and a flat compass ring also
made the vehicle's attitude hard to read.

### Decision
Rewrite the panel around one explicit body frame — **+X nose, +Y left wing, +Z up** — with
roll/pitch/yaw wired to the matching axes and signs verified numerically against telemetry
(right bank drops the right wing, nose-up lifts the nose, heading-up swings the nose
clockwise). Render a recognizable aircraft (fuselage, swept wings, stabilizer, vertical fin)
through a fixed chase camera (~58° elevation, perspective) with painter's-algorithm depth
sorting. Drop the compass ring and axis triad in favor of a static ground grid.

### Consequences
- ✅ Each of roll/pitch/yaw now tracks the readout; orientation is legible at a glance.
- ⚠️ The component still re-implements rotation math rather than consuming a shared logic
  helper (same divergence risk this document flags in ADR-0008); correctness rests on the
  numeric checks, not a single-source transform.

### Alternatives considered
- Patch only the axis swap — corrects the math but leaves the unreadable wireframe/triad.
- Extract a shared 3D transform into `src/logic` — no such helper exists yet; deferred.

## ADR-0010: Nose-relative `forwardPoints` for the perspective corridor

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
The predictive view moved to a forward-looking (nose-camera) perspective. The existing
`TrajectoryResolution.points[]` fuse forward progress and climb onto a single axis (a
heading/track/climb blend for the old 2D plot), which cannot be projected in true 3D.

### Decision
Add `ForwardPathPoint { forwardM, lateralM, verticalM, tSec }` and a `forwardPoints[]` array
to the resolution, integrated in [trajectory.ts](../src/logic/trajectory.ts) in a
**nose-relative frame** (relative heading starts at 0; `+forward` ahead, `+lateral` right,
`+vertical` up). Purely additive — the original `points[]` and its tests are unchanged.

### Consequences
- ✅ The perspective view consumes a clean, unit-tested 3D path; the logic layer stays the
  single source of truth (upholds ADR-0001).
- ⚠️ Two representations of the same path now live in one resolution and must stay in sync.

## ADR-0011: Predictive corridor as a bore-sighted, two-layer HUD

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
The goal for the predictive panel is to replace what a pilot *feels* in the cockpit with a
visual reference — attitude relative to the ground **and** where the nose is predicted to go,
both readable at once. An earlier single-group version glued the corridor to the world and
rolled it opposite to the attitude indicator, so the two horizons disagreed.

### Decision
Render two decoupled SVG layers that rotate about a **fixed boresight cross** at center:
- **World** (ground grid + horizon) rolls with `rotate(-roll)` and pitch-translates, matching
  [HudAttitudeIndicator](../src/components/HudAttitudeIndicator.tsx) exactly so the horizons
  agree.
- **Flight path** (the corridor) banks the **opposite** way, `rotate(+roll)`, so a right bank
  starts it left of the boresight and sweeps it out to the right — mirroring the felt motion.
  Pitch is baked into the path layer's **effective camera height** (nose-down shrinks it, so
  the start lifts above the boresight and the corridor recedes downward). Projection is a
  pinhole camera sitting above the flight path.

### Consequences
- ✅ Ground orientation, flight-path bank, and pitch are all legible together; the corridor's
  horizon matches the attitude indicator by construction.
- ⚠️ Two roll sign conventions coexist (`-roll` world, `+roll` path) and must be kept straight;
  more transform math is re-implemented in the component (the ADR-0008 tension persists).

### Alternatives considered
- A single stabilized plan view — clearer to build, but loses the felt-motion cue.
- One rigid group for world + path — couples them and mismatches the attitude-indicator roll.

## ADR-0012: Corridor surface colored by climb slope, not screen position

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
To disambiguate an up-then-down swoop from a down-then-up one, the corridor surface is
two-toned. Keying the color to **screen height** (above/below the boresight) left a steady
climb half-brown near the aircraft and made the boundary "ebb and flow" with perspective —
the vertical sense was unreadable.

### Decision
Color each ribbon segment by the sign of its **climb** (Δ`verticalM`): a rising stretch shows
the **top** surface (sky), a falling stretch shows the **bottom** (ground), level is neutral.
The color flips only at a real crest or trough. Implemented as per-segment polygons (not a
gradient) so the boundary locks to the data rather than to a fixed screen coordinate.

### Consequences
- ✅ A steady climb/descent reads as one solid hue; genuine crests show a true colour change.
- ⚠️ N polygons per corridor instead of one filled path. The current constant-climb model
  never produces a crest — that only appears once climb-rate telemetry varies over the horizon.
