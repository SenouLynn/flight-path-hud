# Changelog

All notable changes to this project are recorded here. This is a **living document**
maintained by humans and AI agents.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Because
this repo is a validation harness rather than a released product, versioning is loose:
group work under dated headings (and a `[Unreleased]` section for in-flight work) until a
tagged release exists.

## How to update (agents: read this)

- Add notable changes under `[Unreleased]` using the standard groups: **Added**,
  **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.
- One bullet per change, phrased for a human skimming history. Link code with
  repo-relative paths where it helps.
- If a change reflects an architectural decision, add an ADR in
  [docs/decisions.md](docs/decisions.md) and reference it (e.g. `(ADR-0006)`).
- Keep entries factual — what changed and why it matters, not a commit dump.

---

## [Unreleased]

### Added
- Documentation set: [docs/architecture.md](docs/architecture.md) (data flow, module map,
  conventions), plus fleshed-out [heading](docs/heading_indicator.md),
  [attitude/horizon](docs/attitude_and_horizon_indicator.md), and
  [flight path](docs/flight_path_marker.md) references.
- Architecture Decision Record log at [docs/decisions.md](docs/decisions.md), seeded with
  ADR-0001…0008 and extended with ADR-0009…0012 for this session's rendering decisions.
- This changelog.
- Nose-relative 3D path (`ForwardPathPoint` / `forwardPoints`) on `TrajectoryResolution`,
  integrated in [trajectory.ts](src/logic/trajectory.ts) for perspective projection (ADR-0010).
- Predictive trajectory reworked into a forward-looking **perspective corridor**: pinhole
  camera above the flight path, converging floor grid, 1-second depth gates, and a two-tone
  surface — a "road to the horizon" whose vanishing point is the boresight.
- **Bore-sighted, two-layer HUD** framing for the corridor: an earth-referenced world layer
  (grid + horizon) and a flight-path layer roll in opposite directions about a fixed
  boresight cross, with pitch driving the path's camera height (ADR-0011).
- Climb-slope surface colouring: the corridor reads **sky when rising, ground when falling**,
  flipping only at a real crest/trough (ADR-0012).

### Changed
- Renamed `docs/attiude_and_horizon_indicator.md` →
  [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md)
  (fixed typo) and updated all references.
- 3D orientation indicator rebuilt around an explicit aerospace body frame and a fixed chase
  camera, with a recognizable aircraft model and a static ground grid replacing the compass
  ring and X/Y/Z/D axis triad (ADR-0009).
- Corridor start marker raised toward the boresight; the arrow is de-emphasized and now fades
  as the drawn path lengthens; the centerline fades from near to far.

### Fixed
- Predictive trajectory vertical axis was inverted (SVG y-down vs the model's y-up), so a
  climb pointed the marker down and a descent up. Corrected the projection sign in
  [HudPredictiveTrajectory.tsx](src/components/HudPredictiveTrajectory.tsx).
- Orientation indicator roll and pitch were cross-wired — the vehicle model was authored with
  the nose along +Y while the rotation code assumed the aerospace +X-forward frame — so the
  model tipped in the wrong axes (ADR-0009).

### Known issues
- Components still re-implement the pitch/roll→screen transform independently rather than
  consuming a shared logic helper (ADR-0008). The predictive corridor and orientation panel
  are now aligned to the attitude indicator by construction and verified numerically, but the
  underlying duplication — and its inversion risk — remains until the transform is centralized.

## [2026-07-22] — First functional pass (`355baff`)

> Commit message: "first pass - logic is okay, rendering is inverted in some places."

### Added
- Full resolver stack: heading, attitude/horizon, scalar telemetry, 2D track, 3D flight
  path angle, kinematic predictive path (linear + CTRV turn-aware), and an integrated
  predictive trajectory blending heading/track/bank/pitch with wind-drift and stall cues.
- SVG HUD components: primary flight display (heading tape + attitude), 3D orientation
  indicator, and predictive trajectory view.
- Telemetry source adapter (`synthetic-replay` and `live-mock`) plus the
  `useTelemetryFeed` React hook.
- Known-answer replay validation frames and Vitest suites across all logic modules.
- Canonical MAVLink field registry ([mavlinkInputs.ts](src/constants/mavlinkInputs.ts)).

### Known issues
- Rendering inverted in some places (attitude sign-convention duplication — see ADR-0008).

## [2026-07-13] — Project bootstrap (`9315edc`)

### Added
- Initial Vite + React 19 + TypeScript 6 scaffold, ESLint flat config, and the docs
  skeleton.
