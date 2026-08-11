# Mission overlay design

**Status:** approved, not yet implemented.
**Date:** 2026-08-11
**Closes out:** the remainder of [Phase 5](mavlink_gcs_consume_plan.md#phase-5-map-and-mission-visualization-2-to-3-days)
(mission overlay, home point marker) in the MAVLink GCS consume plan.

## What this is

Waypoints and home position on the GCS map: a route line, numbered waypoint
markers with the active one highlighted, a home marker, and a sidebar panel
listing the mission items — fed from a live vehicle over MAVLink's mission
protocol.

## 1. Scope: the receive-only carve-out

The GCS has been receive-only from the start — the bridge has never had a
send socket, and `docs/mavlink_gcs_consume_plan.md`'s Scope section lists
"sending commands (arm, mode, mission upload, parameter writes)" as
explicitly out of scope. Reading a mission requires the GCS to ask for it:
`MISSION_REQUEST_LIST` and `MISSION_REQUEST_INT` are outbound messages to the
vehicle. This is the bridge's first outbound byte, ever.

**Decision:** the bridge gains exactly one outbound capability — a read-only
mission request, fired only when the operator explicitly clicks "Load
mission." No automatic requests on connect, no polling, no other outbound
message type. Home position stays passive-only (§2) — it is observed, never
requested. The vehicle's state is queried; its behavior is never changed.
Arm, mode change, mission upload/write, and parameter write remain entirely
out of scope — nothing here is a step toward them.

**Documentation obligations, tracked as their own line items in the plan
below, not folded into other changes:**
- A new **ADR-0027**, dedicated to this decision alone: what crosses the
  line (a read-only query) and what doesn't (anything that changes vehicle
  behavior).
- An in-place edit to the "Out of scope" bullet in
  `docs/mavlink_gcs_consume_plan.md`, naming this exception and linking
  ADR-0027, so that section stays accurate instead of quietly wrong.
- The outbound send path is one narrowly named function
  (`requestMission()`), not a generic "send to vehicle" capability — nothing
  about its shape invites widening later.

## 2. Wire protocol

Grounded in the [MAVLink Mission (Plan) Protocol](https://mavlink.io/en/services/mission.html),
the `common.xml` message definitions, and QGroundControl's `PlanManager`
(`src/MissionManager/PlanManager.h`/`.cc`) as the reference client
implementation — not reasoned out from first principles.

### Messages

New decoders in `apps/mavlink-bridge/src/normalize.js`, added to
`SUPPORTED_MESSAGE_DECODERS`/`MESSAGE_CRC_EXTRA` the same way existing ones
are:

| Message | ID | Fields used |
|---|---|---|
| `MISSION_COUNT` | 44 | `count` (u16). `mission_type`/`opaque_id` are MAVLink2 extensions, ignored v1. |
| `MISSION_ITEM_INT` | 73 | `seq`(u16), `frame`(u8), `command`(u16, `MAV_CMD`), `current`(u8), `autocontinue`(u8), `param1-4`(float), `x`(int32, lat×1e7), `y`(int32, lon×1e7), `z`(float, alt m) |
| `MISSION_CURRENT` | 42 | `seq`(u16) only — decoded passively, independent of any request, matching how HOME_POSITION is decoded (see below). `total`/`mission_state`/etc. are MAVLink2 extensions, unused. |
| `MISSION_ACK` | 47 | `type`(u8, `MAV_MISSION_RESULT`) — the vehicle sends this unsolicited only on error mid-download; success is *sent by us*, not received (see below). |
| `HOME_POSITION` | 242 | `latitude`/`longitude`(int32, degE7), `altitude`(int32, mm MSL) — same scaling `decodeGlobalPositionInt` already uses. `x/y/z`, `q`, `approach_*`, `time_usec` unused. |

New encoders in a new `apps/mavlink-bridge/src/encode.js` — deliberately
only these two message types, not a general frame builder:

| Message | ID | Purpose |
|---|---|---|
| `MISSION_REQUEST_LIST` | 43 | `target_system`, `target_component`, `mission_type=0`. Opens the pull. |
| `MISSION_REQUEST_INT` | 51 | `target_system`, `target_component`, `seq`, `mission_type=0`. One per item. |
| `MISSION_ACK` | 47 | `target_system`, `target_component`, `type=MAV_MISSION_ACCEPTED`. Closes a successful pull. |

We never send or decode the legacy `MISSION_REQUEST`(40)/`MISSION_ITEM`(39)
pair: a compliant vehicle receiving `MISSION_REQUEST_INT` must answer with
`MISSION_ITEM_INT`, so there is no legacy path to support.

**HOME_POSITION has no request pair in the mission protocol at all.**
Fetching it on demand means `COMMAND_LONG` with `MAV_CMD_GET_HOME_POSITION`
(410) — a structurally separate protocol, its own encode/ack path. This is
why home position stays passive-only for v1: it isn't a smaller version of
the same feature, it's a different one. Revisit only if passive observation
proves insufficient in the field.

### Handshake

```
GCS                                  Vehicle
 │──── MISSION_REQUEST_LIST ────────▶│
 │◀──────── MISSION_COUNT ───────────│   (count = N; N = 0 is a valid, complete mission)
 │──── MISSION_REQUEST_INT(seq=0) ──▶│
 │◀──────── MISSION_ITEM_INT(0) ─────│
 │              ...                  │
 │──── MISSION_REQUEST_INT(seq=N-1)─▶│
 │◀──────── MISSION_ITEM_INT(N-1) ───│
 │──────── MISSION_ACK ─────────────▶│   (we send this; closes the transfer)
```

`MISSION_CURRENT` and `HOME_POSITION` are decoded whenever seen, independent
of this handshake — most autopilots broadcast both periodically on their own.

### Timeouts, retries, and known quirks

Values taken directly from QGroundControl's `PlanManager.h`, not invented:

- **1500 ms** timeout for `MISSION_COUNT` (after `MISSION_REQUEST_LIST`) and
  for the closing `MISSION_ACK`.
- **250 ms** timeout per `MISSION_REQUEST_INT` retry.
- **5** max retries, then the pull fails with an explicit reason (see
  §5 — no silent partial state).
- **Out-of-sequence item:** if a `MISSION_ITEM_INT.seq` doesn't match the
  index we asked for, drop it and re-request the expected index — recoverable
  per spec, not an error.
- **ArduPilot quirk, carried over from QGC:** ignore a stray
  `MAV_MISSION_INVALID_SEQUENCE` ack arriving while items are still in
  flight — real firmware sends spurious ones; treating it as fatal would
  make the first field test fail for no real reason.
- **Any other `MAV_MISSION_RESULT` error** from the vehicle is unrecoverable
  per spec: reset to idle, fail the pull, the vehicle's actual mission is
  never touched.

### State machine

`apps/mavlink-bridge/src/missionSync.js` — transport-agnostic like
`bridgeCore.js`, fed decoded envelopes and a `now`/timer seam for
deterministic tests (mirrors `bridgeCore.test.js`'s injected clock):

```
idle → requested (sent MISSION_REQUEST_LIST)
     → collecting (sent MISSION_REQUEST_INT per index; tracks outstanding)
     → complete (all items in; MISSION_ACK sent)
     → published
   (any state) → failed (retries exhausted / unrecoverable MISSION_ACK) → idle
```

`udpIngress.js` gains a narrow `send(buffer)` alongside its existing
listen-only socket — the only new capability it needs; it remains one UDP
adapter, not two.

## 3. Transport: WebSocket protocol

- **Browser → bridge** (new; the bridge has never accepted inbound WS
  messages before): exactly one message shape,
  `{ type: 'requestMission', sysId, compId }`. Anything else is ignored, not
  routed anywhere — this is not a generic command channel.
- **Bridge → browser:** existing telemetry frames, unchanged, plus one new
  frame kind:
  `{ type: 'mission', sysId, compId, status: 'pending' | 'complete' | 'failed', items?, activeIndex?, reason? }`,
  and a `{ type: 'home', sysId, compId, lat, lon, altMslM }` frame whenever
  `HOME_POSITION` is decoded.

## 4. Persistence: in-memory last-known-state, nothing heavier

The existing WS fan-out (`publish(frame)` in `index.js`) is already
single-producer/multi-consumer pub-sub in miniature; nothing here needs a
broker. What this feature exposes is a real, narrow gap: a client that
connects (or reconnects) *after* a mission was pulled currently sees nothing
until someone clicks "Load mission" again, because the bridge never remembers
anything for new subscribers — telemetry hides this at ~33 Hz, mission
doesn't.

**Decision:** the bridge keeps the **last-known mission and home position in
memory**, same pattern as `bridgeCore.js`'s existing `systems` roster, and
sends them once on WS connect instead of waiting for the next natural event.
No new dependency.

**Considered and rejected:**
- **Redis** — earns its keep with multiple producers/consumers across
  machines or state that must survive the process dying. This is one bridge
  process, one UDP source, LAN-local browser clients, explicitly targeting a
  field Raspberry Pi under an existing no-cloud-infrastructure posture
  (ADR-0024). A second daemon to run and lose track of on that Pi, with no
  deployment shape on the roadmap that would pay for it.
- **SQLite** — the more defensible option, but not for *this*. It would
  matter if mission/session data needed to survive the bridge process
  restarting, which recordings (ADR-0022/0023, JSONL) already solve for the
  same underlying concern. Adding SQLite now would be two persistence
  mechanisms doing overlapping jobs. **Forward-pointer, not a task:** if
  queryable history across sessions (not just "replay one file") becomes a
  real want later, that's a genuine SQLite conversation and deserves its own
  ADR when a real query need is driving it.

## 5. Presentation

Follows the two patterns already established rather than inventing new ones.

**Map (`apps/gcs/src/map/MapPanel.tsx`):**
- **Route** — a second GeoJSON source/layer, same shape as the existing
  `TRACK_SOURCE`/`TRACK_LAYER`, styled distinctly (e.g. dashed) so flown
  track and planned route never read as the same line.
- **Waypoints** — a data-driven symbol/circle layer, not per-point DOM
  markers (unlike the vehicle marker, waypoints don't need continuous
  rotation). Active waypoint highlighted via a paint expression keyed on an
  `active: boolean` feature property.
- **Home** — one more DOM `Marker`, same construction as the vehicle marker,
  visually distinct, shown once a home position has been observed.

**Sidebar (`apps/gcs/src/App.tsx`):** a new "Mission" panel beside
Link/System/Position/Trail — "Load mission" button, status line (idle /
pending / complete / failed-with-reason), item count, active-index readout,
scrollable waypoint list (index, command, lat/lon/alt). Clicking a row to pan
the map there is a nice-to-have, not required for v1.

**`packages/gcs-core` additions**, following `vehicle.ts`/`track.ts`'s
existing per-system fold pattern:
- `mission.ts` — folds `MISSION_*` envelopes into a per-system
  `MissionPlan { items[], activeIndex, status, reason? }`. Keying by system
  from day one costs nothing extra and is exactly the "already multi-node in
  the data layer" pattern ADR-0026 describes.
- `home.ts` — `HOME_POSITION` → `HomePosition`, reprojected through the
  existing `geodesy.ts` ENU helpers rather than a new projection.

**Explicit state, never implied zero:** "not requested yet," "pending,"
"vehicle reports zero waypoints," and "failed" are four distinct states, a
blank list is never ambiguous between them — the same discipline the video
health folds already apply (`null` means "not measured," never faked as
zero).

## 6. Testing & mocking

- **Pure logic** (`mission.ts`/`home.ts`): unit-tested in isolation, same as
  `vehicle.ts`/`track.ts` today.
- **Decode/encode round-trips** (`normalize.test.js` style): hand-built byte
  buffers for each new decoder, CRC-verified output for each new encoder —
  mirrors the existing per-message test pattern exactly.
- **`missionSync.js` state machine:** tested transport-free with a fake
  clock, asserting the QGC-sourced retry/timeout values, out-of-sequence
  drop-and-re-request, and the ArduPilot spurious-ack quirk — no real timers
  or sockets.
- **Mock producer — a real binary responder, not a JSON shortcut.**
  `sampleSender.js` currently mocks telemetry via JSON envelopes
  (`normalize.js`'s `tryParseJsonEnvelope` path); the binary *decoder* is
  only exercised by hand-built buffers in `normalize.test.js`, never by the
  live mock, because the bridge has only ever decoded, not encoded. Mission
  introduces a genuinely new encoder with real CRC/layout risk, so a JSON
  shortcut here would leave it unexercised until real hardware — directly
  against ADR-0026's own pattern ("integrate against a mock that ... speaks
  the real protocol"). The mission mock must decode real
  `MISSION_REQUEST_LIST`/`MISSION_REQUEST_INT` frames and reply with real,
  CRC'd `MISSION_COUNT`/`MISSION_ITEM_INT` frames.
- **Replay limitation, stated rather than silently gapped:** recording/replay
  (ADR-0022) is passive playback of a captured *inbound* stream; it has no
  notion of the bridge's own outbound requests being answered live. A
  recorded session cannot replay a mission pull. "Load mission" is disabled
  in replay mode rather than doing something undefined.

## Deferred, on purpose

- Active `HOME_POSITION` request (`MAV_CMD_GET_HOME_POSITION`) — different
  protocol family; revisit only if passive observation proves insufficient.
- Mission upload/edit — out of scope for the whole GCS, not just this
  feature.
- Rally points and geofence (`MAV_MISSION_TYPE_FENCE`/`_RALLY`) — same
  protocol, different `mission_type` value; not requested until plain
  waypoint missions are proven.
- SQLite-backed session history — forward-pointer only, see §4.
