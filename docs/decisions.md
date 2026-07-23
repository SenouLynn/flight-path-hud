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
