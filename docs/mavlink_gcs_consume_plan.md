# MAVLink v2 GCS Consume-Only Plan

A concrete, roadmap to evolve this repo into a receive-only Ground Control Station (GCS) that can ingest MAVLink streams, visualize telemetry, and display mission/map context and serve as a validation harness. 

## Future Targets (Logged Constraint)

This plan must support both of these runtime targets without rewriting core logic:

- Cloud-relayed web viewer:
  - Vehicle/receiver in field sends MAVLink upstream.
  - Browser GCS consumes a relay stream (typically WebSocket).
- Raspberry Pi ground-station viewer:
  - Local process consumes receiver link directly (for example UDP/serial).
  - Pi-hosted GUI can run without cloud dependency, then optionally relay onward.

Portability rule:
- Core telemetry/domain logic must be transport-agnostic and UI-framework-agnostic.
- MAVLink transport, decode, and relay paths must be swappable adapters behind stable ports.

## Architecture Guardrails (Hexagonal / Ports and Adapters)

Define ports first, then implement adapters:

- Input ports:
  - `TelemetryIngressPort`: emits byte frames or decoded MAVLink envelopes.
  - `MissionIngressPort`: emits mission items/updates.
- Application ports:
  - `TelemetryNormalizationPort`: maps MAVLink payloads to `TelemetrySample`.
  - `StreamHealthPort`: exposes packet rate, heartbeat age, decode/drop counters.
- Output ports:
  - `GcsStreamPort`: publishes normalized stream to UI clients.
  - `RecordingPort`: optional sink for replay capture.

Adapter examples (initial + future):

- Inbound adapters:
  - UDP SITL adapter (initial).
  - Serial receiver adapter (Raspberry Pi target).
  - Log-file replay adapter.
- Outbound adapters:
  - WebSocket broadcast adapter for browser UI.
  - In-process queue adapter for local desktop/Pi GUI.

Non-goal for early phases:
- Do not couple resolver logic to Node sockets, browser sockets, or any single SDK API.

## Scope

- In scope:
  - Consume MAVLink streams from simulation first, real hardware later.
  - Decode core telemetry messages.
  - Normalize data into the existing TypeScript telemetry model.
  - Visualize live telemetry, stream health, map track, and mission overlays.
- Out of scope (for now):
  - Sending commands (arm, mode, mission upload, parameter writes).
  - Flight control authority.
  - Autopilot configuration tooling.

## End State (Phase 1)

A browser GCS page in `apps/web` that can:

- Switch between synthetic stream and external MAVLink stream.
- Show packet rate, heartbeat age, active system/component, and decode errors.
- Render existing HUD instruments from normalized live data.
- Render a map with current position, heading, breadcrumb trail, and mission route preview.

## Architecture Target

1. Ingest (outside browser)
- A small bridge process reads MAVLink bytes (UDP first).
- It decodes messages and forwards normalized payloads over WebSocket.

2. Normalize
- Map decoded messages into `TelemetrySample` shape.
- Preserve field provenance for resolver debugging.

3. UI stream layer
- New `TelemetrySource` implementation subscribes to WebSocket packets.
- Existing resolvers remain unchanged and consume normalized samples.

4. Views
- Keep `UnifiedView` for HUD.
- Add a GCS view with stream diagnostics and map/mission context.

## Concrete Work Plan

## Phase 0: Baseline and Guardrails (0.5 day)

Tasks:
- Confirm clean baseline in web app:
  - `npm run test:web`
  - `npm run build:web`
  - `npm run lint:web`
- Snapshot current synthetic behavior with a short screen capture.
- Decide a canonical external stream input for initial integration:
  - UDP stream from SITL.

Definition of done:
- Baseline build/test/lint pass and synthetic feed still stable.

## Phase 1: Stream Envelope and Contracts (1 day)

Tasks:
- Add a transport-agnostic envelope for external telemetry packets.
- Include metadata:
  - `sysId`, `compId`, `messageName`, `sequence`, `recvTimestampMs`.
- Add TypeScript runtime guards for malformed packets.
- Add test fixtures with representative messages.
- Define explicit port interfaces for ingress and publish paths before implementing adapters.

Proposed file additions:
- `apps/web/src/stream/externalTypes.ts`
- `apps/web/src/stream/externalTypes.test.ts`

Definition of done:
- Packet contracts validated by tests; malformed packets are rejected safely.

## Phase 2: WebSocket Telemetry Source (1 day)

Tasks:
- Add a new `TelemetrySource` implementation backed by WebSocket.
- Keep existing source API (`start(onSample) => stop`) to avoid resolver changes.
- Add reconnect behavior (exponential backoff, capped).
- Expose stream health metrics:
  - packets per second
  - connection state
  - decode errors
  - last heartbeat age

Proposed file additions:
- `apps/web/src/stream/wsTelemetrySource.ts`
- `apps/web/src/stream/wsTelemetrySource.test.ts`

Proposed file edits:
- `apps/web/src/stream/useTelemetryFeed.ts` (optional shape extension for health)

Definition of done:
- UI can consume synthetic stream and WebSocket stream interchangeably.

## Phase 3: Bridge Process for Simulation MAVLink (1.5 to 2 days)

Tasks:
- Create a small bridge app (Node) in this repo:
  - Listen to UDP MAVLink from simulator.
  - Decode messages.
  - Broadcast normalized JSON frames via WebSocket to `apps/web`.
- Map first message set:
  - `HEARTBEAT`
  - `ATTITUDE`
  - `VFR_HUD`
  - `GLOBAL_POSITION_INT`
  - `GPS_RAW_INT`
- Add a simple per-message counter and decode error counter.
- Keep decoder and normalization independent from UDP/WebSocket plumbing so the same core can back a Pi-local adapter.

Proposed workspace addition:
- `apps/mavlink-bridge/`

Suggested internals:
- `apps/mavlink-bridge/src/index.ts`
- `apps/mavlink-bridge/src/decode.ts`
- `apps/mavlink-bridge/src/normalize.ts`
- `apps/mavlink-bridge/src/types.ts`

Definition of done:
- Running simulator produces live packets in browser via WebSocket.
- Existing HUD values update from real decoded telemetry, not only synthetic generator.

## Phase 4: GCS Dashboard View (1 to 1.5 days)

Tasks:
- Add a new route/page for GCS operations panel.
- Show:
  - stream connection status
  - packet rate and heartbeat staleness
  - active sysid/compid
  - recent message types and rates
- Reuse existing resolver-powered components for core telemetry display.

Proposed file additions:
- `apps/web/src/pages/GcsView.tsx`
- `apps/web/src/components/StreamHealthPanel.tsx`
- `apps/web/src/components/MessageRatePanel.tsx`

Proposed file edits:
- `apps/web/src/App.tsx` (add route and nav)

Definition of done:
- One page acts as the first operational receive-only GCS panel.

## Phase 5: Map and Mission Visualization (2 to 3 days)

Tasks:
- Add map component for:
  - current vehicle marker
  - heading vector
  - breadcrumb trail
  - home point marker
- Add mission overlay model:
  - waypoint list
  - polyline segments
  - active mission index highlight
- Feed mission overlay from bridge output (simulated if needed first).

Proposed file additions:
- `apps/web/src/components/GcsMapPanel.tsx`
- `apps/web/src/logic/mission.ts`
- `apps/web/src/logic/mission.test.ts`

Definition of done:
- Live aircraft track and mission route are visible and coherent on map.

## Phase 6: Validation, Replay, and Hardening (1 day)

Tasks:
- Add tests around conversion correctness:
  - NED signs
  - unit scaling (cdeg, degE7, mm, cm/s)
- Add recorded stream replay mode (file-based) for deterministic debugging.
- Add edge-case handling:
  - heartbeat timeout
  - source switch without stale state bleed
  - out-of-order timestamps
- Add adapter contract tests:
  - replay fixture can drive the same ports as UDP/serial ingress
  - UI stream behavior is unchanged across adapters

Definition of done:
- Deterministic replay catches regressions before live tests.

## Near-Term Next Steps (Start Here)

1. Create `externalTypes.ts` and test fixtures in web app.
2. Implement `wsTelemetrySource.ts` with reconnect + health metrics.
3. Scaffold `apps/mavlink-bridge` with UDP input and WebSocket output.
4. Connect bridge output to web app and verify HUD updates.
5. Add `GcsView` with stream health cards.

## Test Checklist Per Phase

- Unit tests for new parser/mapper code.
- Manual test with synthetic source still passing.
- Manual test with bridge disconnected/reconnected.
- Verify heading, climb, and altitude signs against known expected motion.
- Keep `npm run test:web`, `npm run build:web`, and `npm run lint:web` passing.

## Risks and Mitigations

- Risk: Unit/sign mistakes from MAVLink fields.
  - Mitigation: fixture-based tests for each mapped message field.
- Risk: Browser UI jitter from burst packets.
  - Mitigation: throttle display updates while retaining latest sample.
- Risk: Multi-vehicle ambiguity.
  - Mitigation: explicit active `sysId/compId` selector in GCS view.
- Risk: Hidden disconnects.
  - Mitigation: heartbeat age warning thresholds and stale banners.
- Risk: Early implementation accidentally hard-couples to one transport path.
  - Mitigation: define/test ports first; require at least one alternate adapter stub (file replay or serial mock) before phase exit.

## Success Criteria

- You can run one command for the bridge and one for the web app.
- A SITL UDP stream appears as live resolver-driven HUD telemetry.
- Stream health can clearly indicate stale/disconnected feed.
- Map trail and mission overlay make positional behavior intuitive.
- Synthetic replay remains available as a deterministic fallback.
