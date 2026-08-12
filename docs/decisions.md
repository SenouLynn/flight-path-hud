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

## ADR-0028: Multi-node may proceed while every node is synthetic

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** team
- **Amends:** [ADR-0026](#adr-0026-multi-node-awareness-is-a-separate-phase-gated-on-single-node-validation)

### Context
ADR-0026 gated multi-node work on the single-node system being validated against
real hardware or SITL, and recorded "widen presentation now, since the data is
already per-system" as the rejected alternative. The reasoning holds: building on
an unvalidated core multiplies every unproven assumption by the number of nodes.

What that ADR did not separate is *producing* a second node from *presenting* one.
The three bugs it cites as justification — a decoder reading the wrong payload
offsets, a sequence field overflowing a consumer's validator, two senders merging
into one contradictory aircraft — are all failures a second synthetic node
provokes on a desk, cheaply and repeatably. Writing one immediately surfaced a
fourth of the same kind: `decodeMissionRequest` discarded `target_system`, so any
second vehicle would have answered mission requests addressed to its neighbour and
the reply would have been cached under the wrong system key. That defect was
latent in the single-node system and unreachable by single-node testing.

So the gate as written blocks a class of work that *serves* the goal it protects.

### Decision
Multi-node work may proceed **while every node on the link is synthetic**.

The hardware gate is unchanged in substance and still binds:

1. **Producer and domain logic — unblocked.** Additional mock nodes, per-node
   flight profiles, per-node identity and roster folds. All pure, all tested in
   isolation, all exercising the real protocol.
2. **Presentation — still gated as before.** No multi-node UI ships against a
   synthetic-only picture; the map and sidebar stay single-node.
3. **Any claim involving a real source — still gated.** Real hardware or SITL
   remains the precondition for calling multi-node validated, and for building the
   UI that implies it.

`NodeIdentity` lands now rather than later, as ADR-0026 anticipated it would need
to: `sysId:compId` is a MAVLink concept, and `NodeSummary` is a derived projection
over the existing per-system folds — no new accumulated state, nothing new to
bound or evict.

### Consequences
- ✅ The synthetic fleet becomes a validation instrument rather than a liability:
  it found the mission-targeting defect before any second real vehicle could.
- ✅ The pattern ADR-0026 prescribes is followed exactly — logic in isolation,
  tested hard, integrated against a portable mock, presentation last.
- ✅ Single-stream operation is preserved as a first-class mode
  (`MAVLINK_BRIDGE_MOCK_NODES`), so the single-node system stays testable alone.
- ⚠️ The gate is now conditional rather than absolute, which is a weaker thing to
  hold a line with. Mitigated by naming the three tiers explicitly above.
- ⚠️ Presentation assumptions still accumulate untested, exactly as ADR-0026
  accepted. Unchanged by this amendment.

### Alternatives considered
- Leave ADR-0026 absolute and hand-modify the existing mock into a figure eight —
  rejected: it forfeits the multi-node exercise entirely and would have left the
  `target_system` defect in place until real hardware hit it.
- Supersede ADR-0026 outright — rejected: the hardware gate is the part that has
  earned its keep, and nothing here challenges it.
- Build the fleet UI at the same time — rejected: that is precisely the
  "presentation against a synthetic picture" ADR-0026 warns about, and it proves
  nothing about either layer.

## ADR-0027: One narrow outbound capability — a read-only mission request

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** team

### Context
The GCS has been receive-only from the start: the bridge has never had a send
socket, and the [consume plan](./mavlink_gcs_consume_plan.md)'s Scope section lists
"sending commands (arm, mode, mission upload, parameter writes)" as explicitly out
of scope. Reading a mission requires the GCS to ask for it — `MISSION_REQUEST_LIST`
and `MISSION_REQUEST_INT` are outbound messages to the vehicle. This is the
bridge's first outbound byte, ever, and needed an explicit line drawn around it
before writing any code, not after.

### Decision
The bridge gains exactly one outbound capability: a read-only mission request,
fired only when the operator explicitly clicks "Load mission" in the GCS. No
automatic requests on connect, no polling, no other outbound message type. Home
position stays passive-only — observed, never requested (fetching it on demand
would need `COMMAND_LONG`/`MAV_CMD_GET_HOME_POSITION`, a structurally separate
protocol; deferred, see `docs/mission_overlay_design.md` §2). The vehicle's state
is queried; its behavior is never changed. Arm, mode change, mission upload/write,
and parameter write remain entirely out of scope — nothing here is a step toward
them.

The outbound send path is one narrowly named function per message
(`encodeMissionRequestList`/`encodeMissionRequestInt`/`encodeMissionAck` in
`apps/mavlink-bridge/src/encode.js`), not a generic "send to vehicle" capability —
nothing about its shape invites widening later.

### Consequences
- ✅ The line between "query" and "command" has one recorded decision to point to,
  instead of being re-argued the next time someone proposes an outbound message.
- ✅ `encode.js` staying a closed set of three functions makes a future widening
  (e.g. mission upload) a visible, reviewable diff rather than an incremental
  extension of an already-generic sender.
- ⚠️ Home position has no analogous "load now" button; an operator on a vehicle
  that doesn't broadcast `HOME_POSITION` periodically simply never sees one. Judged
  acceptable for v1 — see the design doc's "Deferred, on purpose" section.

### Alternatives considered
- A generic `sendCommand(buffer)` outbound API — rejected: it would make every
  future MAVLink message one config flag away from being sendable, defeating the
  point of the boundary.
- Requesting the mission automatically on connect — rejected: an operator who
  never intends to view the mission would still trigger outbound traffic to the
  vehicle with no action on their part.

## ADR-0026: Multi-node awareness is a separate phase, gated on single-node validation

- **Status:** Accepted — scope amended by [ADR-0028](#adr-0028-multi-node-may-proceed-while-every-node-is-synthetic)
- **Date:** 2026-08-10
- **Deciders:** team

### Context
The intended destination is TAK-style shared awareness: many nodes on one picture,
contributed by MAVLink vehicles, Meshtastic mesh nodes and other CoT participants.

Much of the groundwork is already multi-node. The bridge keeps a TTL-evicted
roster of every `sysId:compId` and warns when one system transmits from two
endpoints; `gcs-core` folds `vehicles`, `tracks`, `origins`, `positions` and
`enuTracks` per system; the UI has a system selector. The gap is presentation, not
data — the map draws the selected system and the sidebar describes one vehicle.

Because so little appears to stand in the way, the tempting move is to widen the
presentation now. That is the decision being recorded against.

### Decision
Multi-node is a **distinct phase**, not an increment, and it does not start until
the single-node system is robust, tested, and validated in real life: real
hardware or SITL rather than our own generator, known gaps closed or consciously
accepted, and the thing used in anger at least once.

The order matters because building multi-node on an unvalidated core multiplies
every unproven assumption by the number of nodes. Several bugs this project has
already hit — a decoder reading the wrong payload offsets, a sequence field
overflowing a consumer's validator, two senders merging into one contradictory
aircraft — would each have been harder to see, not easier, with more nodes on
screen.

When it does start, it follows the pattern this repo has settled into:

1. Build the logic in isolation, portable — pure, no DOM, no transport.
2. Test it hard in isolation; the suite is what makes later change safe.
3. Integrate against a mock that is itself portable and speaks the real protocol,
   so swapping in hardware is a producer change and nothing above it moves.
4. Embellish last.

The target and the specific work are described in
[multi_node_awareness.md](./multi_node_awareness.md).

### Consequences
- ✅ The gate is explicit, so "the folds are already per-system, why not just draw
  them all?" has a recorded answer rather than being re-argued.
- ✅ The per-system folds and TTL sweeps keep earning their place meanwhile: they
  are what makes the eventual step small.
- ✅ The pattern is written down, so the next phase does not have to rediscover
  it — logic first, tests, portable mock, then presentation.
- ⚠️ Some single-node choices will not survive contact with a broader identity
  model. `sysId:compId` is a MAVLink concept; a `NodeIdentity` above it will
  demote `VehicleState` from root to contributor.
- ⚠️ Deferring means the multi-vehicle UI stays unexercised, so presentation
  assumptions accumulate untested. Accepted: an untested presentation layer is
  cheaper to fix than an unvalidated core.

### Alternatives considered
- Widen presentation now, since the data is already per-system — rejected: it
  would validate the multi-node picture against a synthetic single vehicle, which
  proves nothing about either.
- Treat Meshtastic as another MAVLink-ish source — rejected: it forces a mesh node
  into a `sysId:compId` shape that does not fit, and the identity model is the
  part most worth getting right.
- Leave the target undocumented until it is scheduled — rejected: the current
  design is already being steered by it, so the reasoning belongs on the record.

## ADR-0025: One control owns one camera axis; touching it by hand releases it

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** team

### Context
Follow, track-up and tilt all move the same camera, and the app re-asserts itself
on every telemetry frame (~33 Hz). Any manual pan, rotate or tilt was overwritten
within ~30 ms, so dragging simply appeared not to work. Track-up also only applied
inside the follow branch, so it did nothing with follow off. The dependency was
right; expressing it as a silent no-op was not.

### Decision
Each control owns exactly one camera property:

| Control | Owns | Released by |
| --- | --- | --- |
| Follow | centre | reaching for the map; its own toggle; enabling 3D |
| Track up | bearing | reaching for the map; turning Follow off; enabling 3D |
| 3D | pitch | tilting by hand; enabling Follow or Track up |
| Reset view | — | one-shot: bearing 0, pitch 0 |

**Track up is a modifier on Follow, not a peer.** Enabling it enables Follow;
turning Follow off turns it off. Orienting to a vehicle's heading around a centre
the operator chose — with the vehicle possibly off-screen — is disorienting and
serves nothing.

**Reaching for the map hands the camera over.** A `mousedown` (or `touchstart`)
on the canvas drops the vehicle-anchored modes immediately, so the drag that
follows just works. `mousedown` rather than `dragstart` because the handover has
to land before MapLibre begins moving anything — otherwise the app's per-frame
`jumpTo` fights the first few pixels.

The handover deliberately does **not** force a tilt: a sideways pan that suddenly
pitched the map would be its own surprise. The 3D toggle stays a statement about
pitch.

**3D is exclusive with the vehicle-anchored modes.** A tilted camera exists to be
looked around, and Follow/Track up re-anchor it on every telemetry frame, so
holding both leaves the perspective view unusable in practice. Follow and Track up
remain compatible with each other — they own different axes and neither fights the
operator.

Pitch keeps its own release: a hand-tilt clears the 3D toggle via MapLibre's
`pitchstart`, gated on `event.originalEvent` (present for gestures, absent for our
own `jumpTo`/`easeTo`), so the toggle never lies about where the camera is.

Follow and track-up write in a single `jumpTo`.

### Consequences
- ✅ A drag always does something. The operator never has to find and switch off
  a mode before the map will respond.
- ✅ Nothing is ever refused, so there is no disabled-cursor state to explain.
- ⚠️ Any mousedown on the canvas drops Follow, including a bare click with no
  drag. Treated as acceptable: touching the map is a reasonable statement of
  intent, and Follow is one click to restore.
- ✅ Track-up works with follow off — bearing tracks the heading around whatever
  centre the operator chose.
- ✅ Zoom deliberately does *not* release follow: zooming while tracking a vehicle
  is normal and should not drop the mode.
- ⚠️ A control silently switching itself off is only obvious because the button
  is a lit toggle; without that affordance the release would be mysterious.

### Alternatives considered
- Locking the camera while the app owns it, with a `not-allowed` cursor —
  **tried and rejected in review.** It made the mode legible but told the operator
  "no" and required finding the toggle first; handing the camera over on the same
  gesture is strictly better.
- Fully independent axes, with 3D usable alongside Follow — **tried and rejected
  in review.** In principle pitch and centre are orthogonal; in practice a camera
  re-anchored 33 times a second cannot be looked around, so the combination was
  reachable but useless. Exclusivity is the honest encoding of that.
- Making every mode mutually exclusive — rejected: Follow and Track up compose,
  they just compose as base-and-modifier rather than as peers.
- Track up fully independent of Follow — **tried and rejected in review.** Removing
  the dependency was over-correcting: the dependency was real, and the fix was to
  make it visible (enabling Track up enables Follow) rather than to delete it.
- Keeping the app authoritative and ignoring gestures — rejected: that is the
  behaviour that made the map feel broken.
- Re-engaging follow automatically after an idle period — deferred: surprising,
  and there is a button.

## ADR-0024: MapLibre GL as the map renderer; 3D terrain deferred

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** team

### Context
Leaflet was adopted as an explicit stand-in behind a single adapter file. It has
**no rotation support at all** — no bearing, no track-up, no compass — because its
projection assumes north-up. Track-up is standard in QGroundControl and Mission
Planner and is the orientation an operator expects, so this was a capability gap
rather than a preference.

A 3D view was also raised, prompted by
[QGC issue #10943](https://github.com/mavlink/qgroundcontrol/issues/10943), where
a contributor's branch imports OSM data and triangulates it with `earcut.hpp`.

### Decision
Replace Leaflet with MapLibre GL JS. `setBearing`, `setPitch` and `setTerrain` are
native. Migration touched only [MapPanel.tsx](../apps/gcs/src/map/MapPanel.tsx) and
the tile catalogue, which is what the stand-in framing was for.

**Earcut is not something we integrate.** It is a polygon triangulator — a GPU
rendering primitive, not a 3D-maps feature. QGC needs `earcut.hpp` because it is a
native Qt/C++ app building its own renderer. MapLibre GL JS already depends on
`earcut` (`^3.2.3` in its `package.json`) and triangulates internally, so we get it
transitively and never name it.

**3D is split.** Camera *tilt* ships now and works on the existing raster
basemaps. Terrain relief and extruded buildings are explicitly a **nice-to-have to
revisit later, not a requirement and not a blocker**, because they are an
infrastructure decision rather than a rendering one:

- `setTerrain()` needs a **raster-DEM** source. DEM tiles are large and hosted,
  which collides with the Pi's no-cloud rule until someone self-hosts a DEM for an
  operating area.
- `fill-extrusion` buildings need **vector** tiles, in practice an API key
  (MapTiler, Stadia) or a self-hosted tile server.

Nothing about shipping tilt now forecloses either.

### Consequences
- ✅ Rotation, track-up and tilt all work, on the six existing raster basemaps,
  with no new data source, key or hosting.
- ✅ The terrain path stays open behind one API call once tiles are decided.
- ⚠️ Bundle grew from ~390 kB to ~1,272 kB (349 kB gzipped), roughly 3x Leaflet.
  Fine locally; worth measuring on a Pi 5, and code-splitting is the mitigation.
- ⚠️ MapLibre is `[lng, lat]`, the reverse of Leaflet and of this codebase's
  naming. All conversion goes through one `toLngLat` helper; scattering the flip
  would produce a map that silently shows the wrong place.
- ⚠️ `setStyle` replaces sources and layers, so the track layer is re-added on
  every basemap change.

### Alternatives considered
- `leaflet-rotate` plugin — rejected: patches Leaflet internals, tracks upstream
  loosely, and buys rotation only, leaving tilt and terrain still unreachable.
- CSS-transforming the Leaflet container — rejected: hit-testing and bounds keep
  believing the map is north-up, so clicks land in the wrong place.
- Porting QGC's OSM-import approach with earcut — rejected: that is what you build
  when your framework cannot do it; MapLibre can.

## ADR-0023: Recording is on by default, bounded by retention

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** team

### Context
[ADR-0022](#adr-0022-recordreplay-is-the-bridges-second-ingress-adapter) made
recording possible but opt-in, because an uncapped JSONL sink writes ~15 MB/hour
forever. On a field Raspberry Pi that eventually fills the disk, and the process
holds no other unbounded state — every in-memory buffer is capped or TTL-evicted,
so recordings were the only thing that could grow without limit.

Leaving it opt-in meant the useful case (a session you can replay after something
goes wrong) required predicting the problem beforehand.

### Decision
Record by default, and bound it in two places:

- **Per run**: a byte cap (`MAVLINK_BRIDGE_RECORD_MAX_MB`, 256). At the cap the
  recorder *stops* and says so.
- **Across runs**: a startup sweep of the recordings directory by age
  (`_RETAIN_DAYS`, 7) then by total size (`_TOTAL_MAX_MB`, 1024), oldest first.

Each run writes `session-<timestamp>.jsonl`. Recording is skipped while replaying.
`MAVLINK_BRIDGE_RECORD=0` disables it.

### Consequences
- ✅ A session is always available to replay without having predicted the need.
- ✅ Disk use has a stated ceiling instead of growing until something breaks.
- ✅ Deleted files are logged by name, size and reason — flight data never
  disappears silently.
- ⚠️ Stopping at the cap means a long session is incomplete rather than rotated.
  Chosen deliberately: a recording truncated mid-stream is harder to trust than
  one that plainly ends.
- ⚠️ Replay still reads a whole recording into memory, so the per-run cap doubles
  as the replay memory ceiling. Raising it needs streaming reads first.

### Alternatives considered
- Size-based rotation into segments — rejected for now: replay would need to
  stitch segments, and the contract test's byte-for-byte guarantee gets murkier.
- Leaving it opt-in — rejected: the data is most wanted exactly when nobody
  thought to enable it.
- Capping in-memory buffers harder instead — not applicable; they are already
  bounded, and the disk was the only unbounded surface.

## ADR-0022: Record/replay is the bridge's second ingress adapter

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** team

### Context
[ADR-0020](#adr-0020-multi-target-gcs-via-ports-and-adapters) commits to transport-agnostic
ingest, but the bridge had exactly one inbound adapter (UDP) and one outbound (WebSocket),
so the claim was never exercised. The web-side ports in
[streamPorts.ts](../apps/hud/src/stream/streamPorts.ts) were referenced only by their own
tests — defined, not load-bearing.

The [consume plan](./mavlink_gcs_consume_plan.md) makes a second adapter a phase-exit
guardrail, and Phase 6 wants deterministic replay. Live-stream debugging had no reproduction
path: diagnosing a duplicate-sender fault meant rebuilding throwaway capture harnesses.

### Decision
Split the bridge into a transport-agnostic core plus swappable adapters:
[bridgeCore.js](../apps/mavlink-bridge/src/bridgeCore.js) takes datagrams and emits
broadcast frames; [udpIngress.js](../apps/mavlink-bridge/src/udpIngress.js) and
[replayIngress.js](../apps/mavlink-bridge/src/replayIngress.js) share one
`start(onDatagram) => stop` shape; [recording.js](../apps/mavlink-bridge/src/recording.js)
is the `RecordingPort`.

Recordings capture **raw wire bytes** as JSONL, not decoded envelopes, so replay re-runs the
parser and catches decoder regressions. Each entry stores a relative `tMs` for pacing and an
absolute `atMs`, and `parseIncomingDatagram` takes an injected clock — without that seam,
MAVLink frames stamp `recvTimestampMs` from `Date.now()` and "deterministic replay" would not
be deterministic.

### Consequences
- ✅ A contract test asserts replay reproduces the live envelope stream *exactly*
  (`deepEqual`, health included), so the port abstraction is enforced rather than asserted.
- ✅ Deterministic reproduction for debugging; a captured session replays with no vehicle,
  no sender, and no UDP socket.
- ✅ The serial/Pi adapter in ADR-0020 now has a proven shape to implement against.
- ⚠️ The running bridge deliberately does **not** feed recorded timestamps to the core: the
  TTL sweep runs on the wall clock and recorded times would evict every system instantly.
  Determinism is guaranteed at the core/test level, not for the live replay process.
- ⚠️ Recordings are raw captures with no schema version; a wire-format change silently
  invalidates old files.

### Alternatives considered
- Record decoded envelopes — rejected: replay would bypass the parser, so the decoder bugs
  most worth catching (offsets, CRC, framing) would be invisible.
- Replay in the browser as a third `TelemetrySource` — deferred: it would exercise the UI
  path but not the bridge's decode path, and needs the file served to the page.
- Leave `Date.now()` in the decoder and compare loosely in tests — rejected: a test that
  ignores timestamps cannot claim determinism, and this repo has already been bitten by
  tests written to match the behavior rather than the spec.

## ADR-0021: Video streaming is a first-class sidecar with adapter ports

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** team

### Context
An operational GCS typically includes video alongside telemetry and mission views. Planned
camera paths include analog receiver capture (USB capture devices) and digital camera output
(Firefly Split PC-CAM over UVC). Locking the architecture to one capture path or one delivery
protocol would make future deployment profiles brittle.

### Decision
Model video as a first-class sidecar under the same ports-and-adapters strategy as telemetry:

- Add video ingress, relay, and health ports.
- Support both analog and digital camera adapters behind those ports.
- Use a media-router baseline (MediaMTX) with low-latency browser delivery as primary target.
- Keep UI integration protocol-agnostic through a stable video stream contract.

Related architecture and plan details are tracked in:
- [docs/gcs_runtime_blueprint.md](./gcs_runtime_blueprint.md)
- [docs/mavlink_gcs_consume_plan.md](./mavlink_gcs_consume_plan.md)

### Consequences
- ✅ Video can be added without coupling camera transport details into domain telemetry logic.
- ✅ Analog and digital camera paths can coexist and be swapped per deployment target.
- ✅ Cloud and local Pi profiles can reuse one UI contract.
- ⚠️ Introduces additional service/process complexity and stream-health surface area.
- ⚠️ Requires explicit latency and reconnect observability in the operator UI.

### Alternatives considered
- Defer video architecture until after telemetry implementation — rejected because video is core
  to GCS operator workflow and should shape ports/contracts early.
- Couple video directly inside the frontend using a single protocol path — rejected because it
  would hinder adapter portability and Pi/cloud parity.

### Implementation preference note (2026-08-07)
- Default first path: Firefly PC-CAM (UVC) adapter with WebRTC browser delivery via MediaMTX.
- Secondary path: analog receiver via USB capture adapter.
- Optional path: OpenIPC as an additional network-stream adapter when hardware supports it.
- Constraint: all three paths must terminate at the same video relay and UI port contracts.

## ADR-0020: Multi-target GCS via ports and adapters

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** team

### Context
The receive-only MAVLink GCS now has two intended deployment modes: a browser viewer fed through
cloud relay, and a Raspberry Pi ground-station GUI that may read directly from local
receiver-linked transports (UDP/serial) before any upstream relay. Building around a single
transport or runtime would make the second target expensive to add.

### Decision
Adopt a hexagonal (ports-and-adapters) structure for MAVLink ingest and publish paths:

- Keep telemetry domain/resolver logic transport-agnostic and UI-framework-agnostic.
- Define ingress/normalization/stream-health ports first.
- Implement UDP SITL and WebSocket adapters first, with serial/file replay as planned follow-on
  adapters.

The implementation plan is tracked in
[docs/mavlink_gcs_consume_plan.md](./mavlink_gcs_consume_plan.md).

### Consequences
- ✅ Web/cloud and Pi-local deployment can share one domain core.
- ✅ Transport changes (UDP, serial, replay file, cloud relay) stay adapter-scoped.
- ✅ Testing can use adapter contract fixtures and deterministic replay.
- ⚠️ Requires explicit port contracts and interface discipline up front.
- ⚠️ Adds minor boilerplate compared with a direct socket-to-UI path.

### Alternatives considered
- Build directly around WebSocket/browser path first and refactor later — rejected because it
  would likely entangle domain flow with one runtime and increase later Pi integration cost.

## ADR-0018: Isolate rendering experiments in sibling applications

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** team

### Context
The Vite application is a productive SVG-based validation harness, while the prospective
Dear ImGui React runtime has a native CMake/Static Hermes toolchain and an uncertain ESP32
path. Replacing the browser harness would combine unrelated iteration loops and make either
toolchain harder to run independently.

### Decision
Make the repository an npm workspace monorepo. Move the current application unchanged to
[apps/hud](../apps/hud) and reserve [apps/desktop](../apps/desktop)
for a separately bootstrapped upstream runtime checkout. The projects have independent build
commands and no shared runtime dependency.

### Consequences
- ✅ Both rendering approaches can be tried independently from their own directories.
- ✅ The hud harness remains the canonical home of the existing TypeScript logic and tests.
- ⚠️ The ImGui experiment is intentionally not version-pinned or vendored until the spike
  proves worthwhile.

### Alternatives considered
- Replace the Vite application — rejected because it would discard a useful SVG validation
  surface before the native prototype is proven.

## ADR-0019: Firmware core is host-runnable and renderer-agnostic

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** team

### Context
The ESP32 application needs C++ code that can be verified quickly without a board, while the
display controller and its final graphics library have not been selected. Tying HUD geometry to
Arduino now would make desktop testing and hardware replacement unnecessarily difficult.

### Decision
Create [apps/esp32](../apps/esp32) as a PlatformIO Arduino project with a portable `hud/` C++
library. Scene composition emits a tiny line/text `HudDrawTarget` interface. A system-C++ host
runner implements that interface as SVG, while the future ESP32 display adapter will implement
the same interface through the chosen OLED driver.

### Consequences
- ✅ Resolver behavior and generated draw geometry are testable locally with `make test` and
  `make run`, before flashing firmware.
- ✅ Display-library selection remains a narrow adapter decision rather than a rewrite of HUD
  math or layout.
- ⚠️ The initial `esp32dev` target and serial-only firmware entry point must be tailored once
  the actual ESP32 variant and OLED controller are known.

### Alternatives considered
- Start directly in Arduino `setup()`/`loop()` — rejected because it would require hardware for
  every visual or numerical validation cycle.

## ADR-0001: HUD logic as pure, framework-free resolvers

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** team

### Context
The end target is an ESP32 firmware HUD (the README's "translate into C++" goal). We need
to iterate on the math quickly in a rich UI, but the math must not get entangled with React
or the browser or it won't be portable.

### Decision
All HUD math lives in pure functions under [src/logic/](../apps/hud/src/logic/), each of the form
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
`sanitizeTelemetrySample` in [telemetry.ts](../apps/hud/src/logic/telemetry.ts) coerces any
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
[heading.ts](../apps/hud/src/logic/heading.ts) and [heading_indicator.md](./heading_indicator.md).

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
`atan2(-vz, √(vx²+vy²))`. Centralized in [flightPath.ts](../apps/hud/src/logic/flightPath.ts).

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
[trajectory.ts](../apps/hud/src/logic/trajectory.ts) additionally blends heading/track and adds a
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
[replay.ts](../apps/hud/src/logic/replay.ts) holds hand-derived expected values for synthetic
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
[HudAttitudeIndicator.tsx](../apps/hud/src/components/HudAttitudeIndicator.tsx) re-implements the
pitch/roll→screen transform instead of consuming `computeHorizonTransform` from
[attitude.ts](../apps/hud/src/logic/attitude.ts). The two define sign conventions independently, so
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
The 3D orientation panel ([HudOrientationIndicator.tsx](../apps/hud/src/components/HudOrientationIndicator.tsx))
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
- Extract a shared 3D transform into `apps/hud/src/logic` — no such helper exists yet; deferred.

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
to the resolution, integrated in [trajectory.ts](../apps/hud/src/logic/trajectory.ts) in a
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
  [HudAttitudeIndicator](../apps/hud/src/components/HudAttitudeIndicator.tsx) exactly so the horizons
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

## ADR-0013: Hybrid position resolver — absolute GPS with velocity-integration fallback

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
The flight-path recorder needs the aircraft's position over time, but `TelemetrySample`
modeled only velocities — no absolute position. Real `GLOBAL_POSITION_INT` carries
`lat`/`lon`/`alt`; a recorded log (ArduPilot `.bin`, MissionPlanner `.tlog`) would too. But a
live feed may momentarily lack a fix, and the existing mocks emit velocity only.

### Decision
Add [position.ts](../apps/hud/src/logic/position.ts) with a `source`-tagged fallback chain
(upholding ADR-0003): prefer absolute `GLOBAL_POSITION_INT.lat/lon/alt` projected to local
ENU (`'GLOBAL_POSITION_INT.lla_enu'`), else dead-reckon NED velocity over dt
(`'GLOBAL_POSITION_INT.vxvy_vz_integrated'`), else `'none'`. Extend `GlobalPositionIntSample`
with `latDegE7`/`lonDegE7`/`altMm`/`relativeAltMm` (sanitized per ADR-0002) and register the
four fields in [mavlinkInputs.ts](../apps/hud/src/constants/mavlinkInputs.ts). The synthetic-replay
source carries the absolute track; live-mock stays velocity-only, so switching sources in the
UI visibly flips the `source`.

### Consequences
- ✅ One resolver serves both real GPS logs and velocity-only streams; provenance is visible
  and assertable, and directly informs which fields firmware must guarantee.
- ✅ The two branches are each continuously exercised by a real UI toggle.
- ⚠️ Dead-reckoned position drifts (no absolute reference) and mixing the two frames within
  one track would jump; the accumulator resets origin on source switch (ADR-0014).

### Alternatives considered
- Absolute-only — simplest, but the recorder goes blank whenever a fix is absent.
- Velocity-only — works with today's fields, but drifts and never uses real GPS.

## ADR-0014: Stateful breadcrumb accumulation in a hook; resolver stays a pure fold

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
A trajectory *recording* needs history, but every `apps/hud/src/logic` resolver is stateless
(ADR-0001) and `useTelemetryFeed` keeps only the latest sample. Position integration
fundamentally needs the previous point + dt — genuine mutable state, the first such need in
the harness.

### Decision
Keep the math pure: `resolvePositionStep(prev, sample, origin)` takes prior state as an
argument, and `resolveTrack(samples[])` folds it for batch/log/replay use — both portable to
C++. Quarantine mutability in [useFlightTrack.ts](../apps/hud/src/stream/useFlightTrack.ts), a React
hook owning the ring buffer, captured origin, and integrator state in refs. It bounds the
track (`maxPoints` + optional `maxAgeSec`): full track for finite/replay sources, rolling
window for the open-ended live feed. Appends are gated on the feed's monotonic `packetCount`
(StrictMode/dup-safe); source switch resets origin+buffer, guarded on read against a stale
snapshot.

### Consequences
- ✅ The logic layer remains the single, pure, testable source of truth; only the React
  adapter holds state. A finite log is just a sample array fed to `resolveTrack`.
- ⚠️ First deviation from "no state in the data path"; the hook now carries reset/dedup
  concerns that must stay correct across StrictMode and source switches.

### Alternatives considered
- Accumulate inside the resolver (module-level buffer) — breaks purity and C++ portability.
- Extend `useTelemetryFeed` to keep history — overloads a hook other instruments use latest-only.

## ADR-0015: Local ENU tangent-plane frame via equirectangular projection

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** team

### Context
The recorder is world-referenced (unlike the nose-relative corridor, ADR-0010). GPS is
geodetic (lat/lon/alt); rendering needs cartesian meters. At HUD/flight scale a full geodesic
is overkill, but the axis and sign conventions must be pinned to avoid a mirrored or inverted
track — the class of bug ADR-0005 guards for velocity.

### Decision
Project fixes into a local **ENU** frame (x=East, y=North, z=Up) anchored at the first fix,
using an equirectangular approximation: `north = Δlat·111319.49`, `east =
Δlon·111319.49·cos(lat0)`, `up = Δalt_mm/1000`. NED velocity maps in as vx→North, vy→East,
−vz→Up (per ADR-0005). The `METERS_PER_DEG_LAT` constant is duplicated in `logic/` rather than
shared from `stream/` to keep the resolver dependency-free. The render ground plane is
anchored to the track's **minimum** altitude so shadows always fall downward, even when a
dead-reckoned track drifts below its origin.

### Consequences
- ✅ Sub-meter-accurate at flight scale, trivially portable, one documented frame convention.
- ⚠️ Error grows with distance from the origin and near the poles (equirectangular, not
  geodesic); acceptable for a single flight's extent. Mixed-origin tracks are not composable.

### Alternatives considered
- Full geodetic/ECEF conversion — accurate everywhere, unnecessary math for HUD-scale extents.
- Web-Mercator — distorts distances by latitude and complicates the vertical axis.

## ADR-0016: Static parameter playground as a visual validation surface

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** team

### Context
The logic resolvers are proven numerically by replay unit tests, but a passing test does not
prove the *rendered* HUD is correct — sign or convention drift (see the attitude two-source
inversion noted in [architecture.md](architecture.md)) is invisible to a number-only test. The
only way to see the instruments move was to watch a mock source replay on a `setInterval`
loop, where the operator is a passive observer of a fixed dataset. We wanted a static "moment
in time" where dynamism comes from tweaking parametrized inputs, complementing the automated
suite with a human-in-the-loop visual check.

### Decision
Add a second route, `/playground` ([src/pages/PlaygroundView.tsx](../apps/hud/src/pages/PlaygroundView.tsx)),
alongside the existing dashboard (`/validator`). Sliders for roll, pitch, heading, airspeed,
and stall speed are packed into a **real, sanitized `TelemetrySample`** by
[buildStaticSample](../apps/hud/src/stream/staticSample.ts) and run through the identical production
resolver stack (`resolveAttitude` / `resolveHeading` / `resolveScalarTelemetry` /
`resolvePredictiveTrajectory`) that drives the live feed. A derived-values panel surfaces the
resolver outputs beside the instruments — a live mirror of a single test case. Global
positioning is excluded (meaningless for a static instant), so the Flight Path Recorder is
omitted. Routing uses `react-router-dom` with a `HashRouter` (the app has no backend and may be
served statically), the first non-React runtime dependency.

As part of this, **airspeed becomes a first-class telemetry field**: `airSpeedMps` is added to
`VfrHudSample` and resolved by `resolveScalarTelemetry`, and the air-relative physics in
[trajectory.ts](../apps/hud/src/logic/trajectory.ts) (stall flag, forward reach, climb geometry, bank-turn
denominator) now key off airspeed — falling back to groundspeed when airspeed is absent. Stall
is fundamentally an airspeed phenomenon; the previous code compared it against groundspeed,
which only holds in still air.

### Consequences
- ✅ Visual validation of the render pipeline, not just the math; the exact resolver stack is
  exercised, so the playground cannot drift from production behavior.
- ✅ Airspeed/groundspeed are now distinct channels, correcting a real conflation and improving
  the live HUD too. The `?? groundspeed` fallback keeps every existing caller and replay frame
  unchanged (additive, opt-in behavior).
- ⚠️ First non-React dependency (`react-router-dom`). `HashRouter` yields `/#/playground` URLs
  rather than clean paths — an accepted trade for zero server configuration.
- ⚠️ Stall speed remains a config parameter (playground slider), not a telemetry field; a future
  ADR may promote it if a real vehicle parameter source appears.

### Alternatives considered
- Lightweight `useState` view toggle instead of a router — rejected in favor of real,
  addressable routes for a growing multi-page app.
- Keeping airspeed playground-local (feed groundspeed, pass stall via config) — rejected because
  it leaves the core conflation in place and misses the chance to model airspeed properly.

## ADR-0017: Trajectory turn/climb from body-rate Euler kinematics, not static bank/pitch

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** team

### Context
The predictive trajectory ([trajectory.ts](../apps/hud/src/logic/trajectory.ts)) derived its path geometry
from the static Euler *angles*: turn rate as `yawspeed + g·tan(roll)/V` and vertical rate as
`V·sin(pitch)`. Three defects surfaced when validating on the playground (ADR-0016):
1. **Turn double-count.** In coordinated flight the measured body yaw rate `r` already ≈
   `g·tan φ/V`, so adding a bank-derived rate on top roughly doubled the turn.
2. **Bank ≠ turn.** A held bank with no rotation (a slip) still predicted a turn; the model
   could not represent "banked but not turning."
3. **Pitch ≠ flight-path angle.** `V·sin(pitch)` ignores angle of attack (γ = θ − α), so a level
   coordinated turn — nose-up to hold altitude — showed a phantom climb.

### Decision
Drive the path from the aircraft's **rotation and velocity state**, using only common-dialect
MAVLink and staying a pure single-sample function (no history):

- **Turn rate** is the Euler kinematic transform of body rates `ψ̇ = (sin φ·q + cos φ·r)/cos θ`
  (`q` = `ATTITUDE.pitchspeed`, newly plumbed; `r` = `yawspeed`). When banked, pitch rate feeds
  heading change — the coordinated-turn coupling falls out of the kinematics. The rates are
  trusted whenever present (even zero); the coordinated-turn formula `g·tan φ/V` is kept only as
  the **fallback** for attitude-only samples, and is also surfaced as
  `coordinatedTurnRateRadPerSec` so a caller can read slip/skid by comparing it to the actual
  rate — coordination feedback without a sideslip field.
- **Climb** comes from the **velocity vector**: initial flight-path angle `γ₀ = asin(vs/V)` from
  measured vertical speed when known, else the pitch proxy. It then bends over the horizon at
  `γ̇ = cos φ·q − sin φ·r`. This is the seam a future velocity-vector flight-path marker plugs
  into. `cos θ` is guarded away from zero (|pitch| capped at 80° for that division).
- The forward **pace** stays the stall-referenced speed (`max(0, V − stall)`) to preserve the
  below-stall corridor collapse and the tuned camera scale; only the velocity vector's
  *direction* (γ, ψ) carries the corrected geometry.

The static playground ([PlaygroundView.tsx](../apps/hud/src/pages/PlaygroundView.tsx)) splits inputs into
**airframe** (roll, pitch, pitch-rate, yaw-rate) and **velocity vector** (airspeed, flight-path
angle, heading) groups; FPA is entered as a `climbMps = V·sin γ` so pitch drives only the display.

### Consequences
- ✅ Coordinated turns are correct: nose-up banked turns stay level; a slip (bank, no rotation)
  no longer fabricates a turn; the turn rate is no longer doubled.
- ✅ Stateless and portable — body rates are instantaneous ATTITUDE fields, so the resolver still
  ports cleanly to the ESP32 with no sample history.
- ✅ Coordination (slip/skid) is readable from `actual vs coordinated` turn rate, with zero
  non-standard MAVLink.
- ✅ The Euler transform is shared (`headingRateFromBodyRates` / `climbAngleRateFromBodyRates` in
  [attitude.ts](../apps/hud/src/logic/attitude.ts)) so both the trajectory corridor and the CTRV
  `resolvePredictivePath` rotate on the same earth-frame heading rate — `yawspeed` means body `r`
  everywhere. A no-op for wings-level frames, so the replay fixtures are unchanged.
- ⚠️ Attitude-only samples still can't separate climb from turn (the AoA wall); full fidelity
  needs the velocity vector, which is now the primary path when vertical speed is present.
- ⚠️ True aerodynamic coordination (induced drag / lift loss in a slip) is out of scope; the
  model is kinematic, not a force model. Sideslip would need `AOA_SSA` (non-common dialect).

### Alternatives considered
- Coordinated-turn rate as primary (bank → turn), rates as a correction — rejected: it can't
  represent a slip and re-introduces the "bank always turns" error; better as the fallback only.
- Finite-differencing attitude across samples to get rates — rejected: introduces state, defeats
  the pure single-sample/portability property when the rate fields already exist.
- Sideslip-based coordination (`AOA_SSA`) — deferred: not in the common MAVLink dialect (per the
  playground's constraint).
