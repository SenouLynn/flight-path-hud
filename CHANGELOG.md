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
  ADR-0001…0008.
- This changelog.

### Changed
- Renamed `docs/attiude_and_horizon_indicator.md` →
  [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md)
  (fixed typo) and updated all references.

### Known issues
- Live attitude HUD and the replay-preview horizon can invert relative to each other due to
  duplicate transform implementations (ADR-0008, tracked from commit `355baff`).

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
