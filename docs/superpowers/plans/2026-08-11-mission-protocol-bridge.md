# Mission protocol bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/mavlink-bridge` its first outbound capability — a read-only MAVLink mission pull, fired only on an explicit browser request — and broadcast the result (plus passively-observed home position) over the existing WebSocket, with a real binary mock vehicle to test against.

**Architecture:** Same layering the bridge already uses (`bridgeCore.js` transport-agnostic core, thin `index.js` wiring, swappable ingress adapters). Two new transport-agnostic modules — `missionSync.js` (per-vehicle mission-pull state machine) and `missionRouter.js` (multi-vehicle router + last-known-state cache) — sit beside `bridgeCore.js`. `normalize.js` gains decoders for what the vehicle sends; a new `encode.js` gains encoders for the three messages the bridge now sends; a new `mavlinkFrame.js` holds the CRC/frame-building primitives both share.

**Tech Stack:** Node.js, `node:dgram`, `node:test` + `node:assert/strict` (existing bridge conventions — no mocking library, real sockets/buffers in tests).

**Companion plan:** `docs/superpowers/plans/2026-08-11-mission-overlay-ui.md` builds the GCS-side consumption of the wire frames this plan produces. Run this one first — it defines the contract the UI plan codes against.

## Global Constraints

- Source spec: `docs/mission_overlay_design.md`. Where this plan fills in a wire-level
  detail the design doc left open, the reasoning is called out inline — it is not
  invented casually.
- **CRC_EXTRA and payload-length constants below are verified against
  `mavlink/c_library_v2`'s generated headers (`mavlink_msg_*.h`), not hand-derived.**
  Do not change them without re-checking against that source.
- The bridge's only outbound MAVLink messages, ever, are `MISSION_REQUEST_LIST` (43),
  `MISSION_REQUEST_INT` (51), and `MISSION_ACK` (47) — fired only from an explicit
  `requestMission` client message. No automatic requests on connect, no polling.
- `HOME_POSITION` stays passive-only: decoded whenever seen, never requested.
- MAVLink v1 framing only for everything this plan encodes (0xFE magic, 6-byte
  header, no extension fields). `mission_type` is omitted rather than sent as 0 —
  every compliant receiver defaults an absent `mission_type` to
  `MAV_MISSION_TYPE_MISSION` (0), so this is not a behavioral difference, only a
  smaller frame.
- Verified per-message constants (from `mavlink/c_library_v2`):

  | Message | ID | CRC_EXTRA | v1 payload len | Fields (offset:type) |
  |---|---|---|---|---|
  | MISSION_REQUEST_LIST | 43 | 132 | 2 | target_system(0:u8), target_component(1:u8) |
  | MISSION_REQUEST_INT | 51 | 196 | 4 | seq(0:u16), target_system(2:u8), target_component(3:u8) |
  | MISSION_ACK | 47 | 153 | 3 | target_system(0:u8), target_component(1:u8), type(2:u8) |
  | MISSION_COUNT | 44 | 221 | 4 (min) | count(0:u16), target_system(2:u8), target_component(3:u8) |
  | MISSION_ITEM_INT | 73 | 38 | 37 (min) | param1(0:f32),param2(4:f32),param3(8:f32),param4(12:f32),x(16:i32),y(20:i32),z(24:f32),seq(28:u16),command(30:u16),target_system(32:u8),target_component(33:u8),frame(34:u8),current(35:u8),autocontinue(36:u8) |
  | MISSION_CURRENT | 42 | 28 | 2 (min) | seq(0:u16) |
  | HOME_POSITION | 242 | 104 | 12 (min) | latitude(0:i32), longitude(4:i32), altitude(8:i32) |

  ("min" = MAVLink v1 length; these messages have MAVLink2-only extension fields
  after this point, per the design doc — ignored throughout.)
- `MAV_MISSION_RESULT`: `MAV_MISSION_ACCEPTED = 0`, `MAV_MISSION_INVALID_SEQUENCE = 13`
  (verified against the MAVLink common dialect). No other result code is
  special-cased — anything else nonzero is an unrecoverable pull failure.
- Timeouts/retries, from QGroundControl's `PlanManager.h` per the design doc:
  1500 ms for `MISSION_COUNT`, 250 ms per `MISSION_REQUEST_INT` retry, 5 max retries.
- **Wire shapes are always fully populated, never `?`-optional**, deviating from the
  design doc's literal `items?`/`activeIndex?` notation: every `mission` frame
  carries `items: []` (not an omitted key) when there are none, and
  `activeIndex: null` when unknown. This is the same "never implied zero"
  discipline §5 already asks for, applied consistently to the wire shape itself
  rather than left as a client-side merge decision.
- Frame shapes this plan produces on the bridge→browser socket, additional to the
  unchanged per-message telemetry frame:
  - `{ type: 'mission', sysId, compId, status: 'pending'|'complete'|'failed', items: MissionItem[], activeIndex: number|null, reason: string|null }`
    where `MissionItem = { seq, command, current, autocontinue, latDeg, lonDeg, altM }`.
  - `{ type: 'home', sysId, compId, lat, lon, altMslM }`.
  - `{ type: 'linkMode', replayMode: boolean }` — **an addition beyond the design
    doc's literal wire list**, needed to make "'Load mission' is disabled in replay
    mode" (design §6) possible: the browser has to know it's in replay mode
    *before* the operator clicks the button, not just after. Sent once per new
    connection, alongside the cached mission/home snapshot. The companion UI plan
    consumes it.
  - Browser→bridge stays exactly `{ type: 'requestMission', sysId, compId }`
    per design §3.

---

### Task 1: Document the outbound-capability decision

**Files:**
- Modify: `docs/decisions.md` (insert a new entry above `## ADR-0026`)
- Modify: `docs/mavlink_gcs_consume_plan.md:58-61` (the "Out of scope" bullet)

**Interfaces:**
- Produces: ADR-0027, referenced by name in later tasks' code comments.

- [ ] **Step 1: Add ADR-0027 to `docs/decisions.md`**

Insert immediately above the `## ADR-0026` heading (newest-first log order):

```markdown
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
```

- [ ] **Step 2: Edit the "Out of scope" bullet in `docs/mavlink_gcs_consume_plan.md`**

Change:
```markdown
- Out of scope (for now):
  - Sending commands (arm, mode, mission upload, parameter writes).
```
to:
```markdown
- Out of scope (for now):
  - Sending commands (arm, mode, mission upload, parameter writes) — **except** a
    single read-only mission request (`MISSION_REQUEST_LIST`/`MISSION_REQUEST_INT`),
    fired only on explicit operator action. See [ADR-0027](./decisions.md).
```

- [ ] **Step 3: Review**

Read both edits back. Confirm ADR-0027 sits above ADR-0026 (newest-first) and the
consume-plan bullet links to it. No automated test applies to a docs-only change.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions.md docs/mavlink_gcs_consume_plan.md
git commit -m "docs: ADR-0027 — one read-only mission request as the bridge's first outbound capability"
```

---

### Task 2: Extract shared MAVLink v1 framing primitives

**Files:**
- Create: `apps/mavlink-bridge/src/mavlinkFrame.js`
- Modify: `apps/mavlink-bridge/src/normalize.js` (replace the local CRC functions with a re-export)
- Test: `apps/mavlink-bridge/src/mavlinkFrame.test.js`

**Interfaces:**
- Produces: `crcAccumulate(byte, crc) -> number`, `computeFrameCrc(buffer, startOffset, endOffset, crcExtra) -> number`, `buildMavlinkV1Frame(msgId, payload, { sequence, sysId, compId, crcExtra }) -> Buffer`.
- Consumed by: Task 3 (normalize.js's new mock-support encoders), Task 4 (encode.js).

This is a pure refactor — `normalize.test.js`'s existing imports of `computeFrameCrc`/`crcAccumulate` from `./normalize.js` must keep working unchanged, so this has to be a re-export, not a moved-and-broken import.

- [ ] **Step 1: Create `mavlinkFrame.js` with the CRC primitives moved out of `normalize.js`**

```js
const MAVLINK_V1_MAGIC = 0xFE

/** MAVLink X.25 checksum (CRC-16/MCRF4XX): reflected poly 0x1021, init 0xFFFF. */
export function crcAccumulate(byte, crc) {
  let tmp = byte ^ (crc & 0xFF)
  tmp = (tmp ^ (tmp << 4)) & 0xFF
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
}

/** Checksum over [startOffset, endOffset) — len byte through payload — plus CRC_EXTRA. */
export function computeFrameCrc(buffer, startOffset, endOffset, crcExtra) {
  let crc = 0xFFFF

  for (let index = startOffset; index < endOffset; index += 1) {
    crc = crcAccumulate(buffer[index], crc)
  }

  return crcAccumulate(crcExtra, crc)
}

/**
 * Build one MAVLink v1 frame: magic, len, seq, sysid, compid, msgid, payload, CRC.
 * No MAVLink2, no signing, no extension fields — every message this bridge sends
 * or the mission mock replies with fits in v1 (see mission_overlay_design.md §2).
 */
export function buildMavlinkV1Frame(msgId, payload, { sequence, sysId, compId, crcExtra }) {
  const frame = Buffer.alloc(6 + payload.length + 2)
  frame[0] = MAVLINK_V1_MAGIC
  frame[1] = payload.length
  frame[2] = sequence & 0xFF
  frame[3] = sysId
  frame[4] = compId
  frame[5] = msgId
  payload.copy(frame, 6)

  const crc = computeFrameCrc(frame, 1, 6 + payload.length, crcExtra)
  frame.writeUInt16LE(crc, 6 + payload.length)

  return frame
}
```

- [ ] **Step 2: Re-export from `normalize.js`, deleting the local copies**

In `apps/mavlink-bridge/src/normalize.js`, delete the `crcAccumulate` and
`computeFrameCrc` function bodies (currently lines 218–234) and replace with:

```js
export { computeFrameCrc, crcAccumulate } from './mavlinkFrame.js'
```

Add the import at the top of the file (needed by `parseMavlinkFrames`, which still
calls `computeFrameCrc` internally):

```js
import { computeFrameCrc } from './mavlinkFrame.js'
```

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npm run test --workspace @flight-path-hud/mavlink-bridge`
Expected: all existing `normalize.test.js` and `bridgeCore.test.js` tests still PASS
unchanged — this step has no new assertions of its own, only a regression check.

- [ ] **Step 4: Write `mavlinkFrame.test.js` for the newly-extracted builder**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMavlinkV1Frame, computeFrameCrc, crcAccumulate } from './mavlinkFrame.js'

test('CRC matches the published CRC-16/MCRF4XX check vector', () => {
  let crc = 0xFFFF
  for (const byte of Buffer.from('123456789')) {
    crc = crcAccumulate(byte, crc)
  }
  assert.equal(crc, 0x6F91)
})

test('buildMavlinkV1Frame produces a frame whose CRC matches computeFrameCrc', () => {
  const payload = Buffer.from([1, 2, 3, 4])
  const frame = buildMavlinkV1Frame(43, payload, { sequence: 7, sysId: 255, compId: 190, crcExtra: 132 })

  assert.equal(frame.length, 6 + payload.length + 2)
  assert.equal(frame[0], 0xFE)
  assert.equal(frame[1], payload.length)
  assert.equal(frame[2], 7)
  assert.equal(frame[3], 255)
  assert.equal(frame[4], 190)
  assert.equal(frame[5], 43)
  assert.deepEqual(frame.subarray(6, 10), payload)

  const expectedCrc = computeFrameCrc(frame, 1, 6 + payload.length, 132)
  assert.equal(frame.readUInt16LE(10), expectedCrc)
})

test('sequence wraps into a uint8', () => {
  const frame = buildMavlinkV1Frame(43, Buffer.alloc(2), { sequence: 300, sysId: 1, compId: 1, crcExtra: 132 })
  assert.equal(frame[2], 300 % 256)
})
```

- [ ] **Step 5: Run the new tests**

Run: `node --test src/mavlinkFrame.test.js` (from `apps/mavlink-bridge`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mavlink-bridge/src/mavlinkFrame.js apps/mavlink-bridge/src/mavlinkFrame.test.js apps/mavlink-bridge/src/normalize.js
git commit -m "bridge: extract MAVLink v1 framing primitives into mavlinkFrame.js"
```

---

### Task 3: Decode the vehicle's mission and home messages

**Files:**
- Modify: `apps/mavlink-bridge/src/normalize.js`
- Test: `apps/mavlink-bridge/src/normalize.test.js`

**Interfaces:**
- Consumes: nothing new (uses existing `SUPPORTED_MESSAGE_DECODERS`/`MESSAGE_CRC_EXTRA` pattern).
- Produces: envelopes with `messageName` one of `MISSION_COUNT`/`MISSION_ITEM_INT`/`MISSION_CURRENT`/`MISSION_ACK`/`HOME_POSITION`, each with a `payload.<lowerCamelName>` section, consumed by Task 6 (`missionSync.js`) and Task 8 (`missionRouter.js`).
- Also produces (mock-support only, not used by the bridge's own runtime):
  `encodeMissionCount({ sysId, compId, count }) -> Buffer`,
  `encodeMissionItemInt({ sysId, compId, item }) -> Buffer` where `item` has the
  same shape produced by `decodeMissionItemInt`'s payload — consumed by Task 7
  (mission mock responder).

- [ ] **Step 1: Add the five decoders**

In `apps/mavlink-bridge/src/normalize.js`, add alongside the existing decoder
functions (after `decodeVfrHud`):

```js
function decodeMissionCount(frame) {
  if (frame.payload.length < 4) {
    return null
  }

  return {
    messageName: 'MISSION_COUNT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionCount: {
        count: frame.payload.readUInt16LE(0),
      },
    },
  }
}

function decodeMissionItemInt(frame) {
  if (frame.payload.length < 37) {
    return null
  }

  return {
    messageName: 'MISSION_ITEM_INT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      // Wire order is size-sorted: the four floats and two ints come before the
      // seq/command pair, which comes before the single bytes — see the CRC/offset
      // table in this plan's Global Constraints, verified against c_library_v2.
      missionItemInt: {
        seq: frame.payload.readUInt16LE(28),
        command: frame.payload.readUInt16LE(30),
        frameId: frame.payload.readUInt8(34),
        current: frame.payload.readUInt8(35) !== 0,
        autocontinue: frame.payload.readUInt8(36) !== 0,
        param1: readFloatLE(frame.payload, 0),
        param2: readFloatLE(frame.payload, 4),
        param3: readFloatLE(frame.payload, 8),
        param4: readFloatLE(frame.payload, 12),
        latDegE7: frame.payload.readInt32LE(16),
        lonDegE7: frame.payload.readInt32LE(20),
        altM: readFloatLE(frame.payload, 24),
      },
    },
  }
}

function decodeMissionCurrent(frame) {
  if (frame.payload.length < 2) {
    return null
  }

  return {
    messageName: 'MISSION_CURRENT',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionCurrent: {
        seq: frame.payload.readUInt16LE(0),
      },
    },
  }
}

function decodeMissionAck(frame) {
  if (frame.payload.length < 3) {
    return null
  }

  return {
    messageName: 'MISSION_ACK',
    payload: {
      timestampMs: frame.recvTimestampMs,
      missionAck: {
        type: frame.payload.readUInt8(2),
      },
    },
  }
}

function decodeHomePosition(frame) {
  if (frame.payload.length < 12) {
    return null
  }

  return {
    messageName: 'HOME_POSITION',
    payload: {
      timestampMs: frame.recvTimestampMs,
      homePosition: {
        latDegE7: frame.payload.readInt32LE(0),
        lonDegE7: frame.payload.readInt32LE(4),
        altMm: frame.payload.readInt32LE(8),
      },
    },
  }
}
```

- [ ] **Step 2: Register the five decoders and their CRC extras**

Change the top of the file:

```js
const SUPPORTED_MESSAGE_DECODERS = {
  0: decodeHeartbeat,
  24: decodeGpsRawInt,
  30: decodeAttitude,
  33: decodeGlobalPositionInt,
  42: decodeMissionCurrent,
  44: decodeMissionCount,
  47: decodeMissionAck,
  73: decodeMissionItemInt,
  74: decodeVfrHud,
  242: decodeHomePosition,
}

const MESSAGE_CRC_EXTRA = {
  0: 50,
  24: 24,
  30: 39,
  33: 104,
  42: 28,
  44: 221,
  47: 153,
  73: 38,
  74: 20,
  242: 104,
}
```

- [ ] **Step 3: Write decode tests for each new message**

Add to `normalize.test.js`, reusing the file's existing `buildMavlinkV1Frame` test
helper and `CRC_EXTRA` map (extend that local map with the five new entries too,
so the existing helper keeps working for them):

```js
test('parses MISSION_COUNT', () => {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(3, 0)
  payload.writeUInt8(1, 2)
  payload.writeUInt8(1, 3)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(44, payload))
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes[0].messageName, 'MISSION_COUNT')
  assert.equal(result.envelopes[0].payload.missionCount.count, 3)
})

test('parses MISSION_ITEM_INT', () => {
  const payload = Buffer.alloc(37)
  payload.writeFloatLE(0, 0)
  payload.writeFloatLE(0, 4)
  payload.writeFloatLE(0, 8)
  payload.writeFloatLE(0, 12)
  payload.writeInt32LE(473977420, 16)
  payload.writeInt32LE(85455940, 20)
  payload.writeFloatLE(120.5, 24)
  payload.writeUInt16LE(2, 28)
  payload.writeUInt16LE(16, 30) // MAV_CMD_WAYPOINT
  payload.writeUInt8(1, 32)
  payload.writeUInt8(1, 33)
  payload.writeUInt8(3, 34) // MAV_FRAME_GLOBAL_RELATIVE_ALT
  payload.writeUInt8(1, 35)
  payload.writeUInt8(1, 36)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(73, payload))
  assert.equal(result.decodeErrors, 0)
  const item = result.envelopes[0].payload.missionItemInt
  assert.equal(item.seq, 2)
  assert.equal(item.command, 16)
  assert.equal(item.current, true)
  assert.equal(item.autocontinue, true)
  assert.equal(item.latDegE7, 473977420)
  assert.equal(item.lonDegE7, 85455940)
  assert.equal(item.altM.toFixed(1), '120.5')
})

test('parses MISSION_CURRENT', () => {
  const payload = Buffer.alloc(2)
  payload.writeUInt16LE(5, 0)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(42, payload))
  assert.equal(result.envelopes[0].payload.missionCurrent.seq, 5)
})

test('parses MISSION_ACK', () => {
  const payload = Buffer.alloc(3)
  payload.writeUInt8(1, 0)
  payload.writeUInt8(1, 1)
  payload.writeUInt8(13, 2) // MAV_MISSION_INVALID_SEQUENCE

  const result = parseIncomingDatagram(buildMavlinkV1Frame(47, payload))
  assert.equal(result.envelopes[0].payload.missionAck.type, 13)
})

test('parses HOME_POSITION', () => {
  const payload = Buffer.alloc(12)
  payload.writeInt32LE(473977420, 0)
  payload.writeInt32LE(85455940, 4)
  payload.writeInt32LE(500000, 8)

  const result = parseIncomingDatagram(buildMavlinkV1Frame(242, payload))
  const home = result.envelopes[0].payload.homePosition
  assert.equal(home.latDegE7, 473977420)
  assert.equal(home.lonDegE7, 85455940)
  assert.equal(home.altMm, 500000)
})
```

Also extend the file-local `CRC_EXTRA` map used by the test file's own
`buildMavlinkV1Frame` helper (a hand-rolled builder distinct from Task 2's shared
one — this test file predates that extraction and stays as-is per this plan's
minimal-blast-radius choice):

```js
const CRC_EXTRA = { 0: 50, 24: 24, 30: 39, 33: 104, 42: 28, 44: 221, 47: 153, 73: 38, 74: 20, 242: 104 }
```

- [ ] **Step 4: Run the tests**

Run: `npm run test --workspace @flight-path-hud/mavlink-bridge`
Expected: all PASS, including the five new tests.

- [ ] **Step 5: Add the mock-support encoders (reverse of the decoders above)**

These exist only so the mission mock (Task 7) can build real, CRC'd responses
without a second CRC/framing implementation. Add to `normalize.js`, importing the
shared builder from Task 2:

```js
import { buildMavlinkV1Frame, computeFrameCrc } from './mavlinkFrame.js'
```

```js
let mockOutboundSequence = 0

/**
 * Encode a MISSION_COUNT reply — used only by the mission mock (sampleSender.js),
 * which plays the vehicle's side of the handshake this bridge initiates. Not used
 * by the bridge's own runtime, which only ever decodes this message.
 */
export function encodeMissionCount({ sysId, compId, count }) {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(count, 0)
  payload.writeUInt8(sysId, 2)
  payload.writeUInt8(compId, 3)

  mockOutboundSequence = (mockOutboundSequence + 1) % 256
  return buildMavlinkV1Frame(44, payload, { sequence: mockOutboundSequence, sysId, compId, crcExtra: 221 })
}

/** Encode a MISSION_ITEM_INT reply. `item` matches decodeMissionItemInt's payload shape. */
export function encodeMissionItemInt({ sysId, compId, item }) {
  const payload = Buffer.alloc(37)
  payload.writeFloatLE(item.param1 ?? 0, 0)
  payload.writeFloatLE(item.param2 ?? 0, 4)
  payload.writeFloatLE(item.param3 ?? 0, 8)
  payload.writeFloatLE(item.param4 ?? 0, 12)
  payload.writeInt32LE(item.latDegE7, 16)
  payload.writeInt32LE(item.lonDegE7, 20)
  payload.writeFloatLE(item.altM, 24)
  payload.writeUInt16LE(item.seq, 28)
  payload.writeUInt16LE(item.command, 30)
  payload.writeUInt8(sysId, 32)
  payload.writeUInt8(compId, 33)
  payload.writeUInt8(item.frameId ?? 3, 34)
  payload.writeUInt8(item.current ? 1 : 0, 35)
  payload.writeUInt8(item.autocontinue ? 1 : 0, 36)

  mockOutboundSequence = (mockOutboundSequence + 1) % 256
  return buildMavlinkV1Frame(73, payload, { sequence: mockOutboundSequence, sysId, compId, crcExtra: 38 })
}
```

- [ ] **Step 6: Test the round trip (mock encoder → this file's own decoder)**

```js
test('encodeMissionCount round-trips through this file\'s own decoder', () => {
  const frame = encodeMissionCount({ sysId: 1, compId: 1, count: 3 })
  const result = parseIncomingDatagram(frame)
  assert.equal(result.decodeErrors, 0)
  assert.equal(result.envelopes[0].payload.missionCount.count, 3)
})

test('encodeMissionItemInt round-trips through this file\'s own decoder', () => {
  const item = {
    seq: 1, command: 16, current: false, autocontinue: true,
    latDegE7: 473977420, lonDegE7: 85455940, altM: 100, frameId: 3,
  }
  const frame = encodeMissionItemInt({ sysId: 1, compId: 1, item })
  const result = parseIncomingDatagram(frame)
  const decoded = result.envelopes[0].payload.missionItemInt
  assert.equal(decoded.seq, 1)
  assert.equal(decoded.current, false)
  assert.equal(decoded.autocontinue, true)
  assert.equal(decoded.latDegE7, 473977420)
})
```

- [ ] **Step 7: Run tests, then commit**

Run: `npm run test --workspace @flight-path-hud/mavlink-bridge` — expect PASS.

```bash
git add apps/mavlink-bridge/src/normalize.js apps/mavlink-bridge/src/normalize.test.js
git commit -m "bridge: decode MISSION_COUNT/ITEM_INT/CURRENT/ACK and HOME_POSITION"
```

---

### Task 4: Encode the bridge's three outbound mission messages

**Files:**
- Create: `apps/mavlink-bridge/src/encode.js`
- Test: `apps/mavlink-bridge/src/encode.test.js`

**Interfaces:**
- Consumes: `buildMavlinkV1Frame`, `computeFrameCrc` from `./mavlinkFrame.js` (Task 2).
- Produces: `encodeMissionRequestList({ sysId, compId, targetSystemId, targetComponentId }) -> Buffer`, `encodeMissionRequestInt({ sysId, compId, targetSystemId, targetComponentId, seq }) -> Buffer`, `encodeMissionAck({ sysId, compId, targetSystemId, targetComponentId, type }) -> Buffer`, `MAV_MISSION_ACCEPTED`, and `decodeMissionRequest(datagram) -> { messageName: 'MISSION_REQUEST_LIST' } | { messageName: 'MISSION_REQUEST_INT', seq } | null` (mock-support). Consumed by Task 6 (`missionSync.js`) and Task 7 (mock responder).

- [ ] **Step 1: Write `encode.js`**

```js
import { buildMavlinkV1Frame, computeFrameCrc } from './mavlinkFrame.js'

const MAVLINK_V1_MAGIC = 0xFE

export const MISSION_REQUEST_LIST_MSG_ID = 43
export const MISSION_REQUEST_INT_MSG_ID = 51
export const MISSION_ACK_MSG_ID = 47

// CRC_EXTRA for the three messages this module builds, verified against
// mavlink/c_library_v2's generated headers. Kept local rather than shared with
// normalize.js's table — the two modules deliberately own disjoint message sets
// (see docs/mission_overlay_design.md §2), MISSION_ACK aside, which appears in
// both because the vehicle can send it (normalize.js decodes that) and the bridge
// can send it (this file encodes that) — the same message ID, two directions.
const CRC_EXTRA = {
  [MISSION_REQUEST_LIST_MSG_ID]: 132,
  [MISSION_REQUEST_INT_MSG_ID]: 196,
  [MISSION_ACK_MSG_ID]: 153,
}

export const MAV_MISSION_ACCEPTED = 0

let outboundSequence = 0

function nextSequence() {
  outboundSequence = (outboundSequence + 1) % 256
  return outboundSequence
}

/**
 * MISSION_REQUEST_LIST(43): opens the pull. `sysId`/`compId` are this bridge's own
 * identity for the frame header; `targetSystemId`/`targetComponentId` address the
 * vehicle being asked.
 */
export function encodeMissionRequestList({ sysId, compId, targetSystemId, targetComponentId }) {
  const payload = Buffer.alloc(2)
  payload.writeUInt8(targetSystemId, 0)
  payload.writeUInt8(targetComponentId, 1)
  return buildMavlinkV1Frame(MISSION_REQUEST_LIST_MSG_ID, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA[MISSION_REQUEST_LIST_MSG_ID],
  })
}

/** MISSION_REQUEST_INT(51): pulls one item by index. */
export function encodeMissionRequestInt({ sysId, compId, targetSystemId, targetComponentId, seq }) {
  const payload = Buffer.alloc(4)
  payload.writeUInt16LE(seq, 0)
  payload.writeUInt8(targetSystemId, 2)
  payload.writeUInt8(targetComponentId, 3)
  return buildMavlinkV1Frame(MISSION_REQUEST_INT_MSG_ID, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA[MISSION_REQUEST_INT_MSG_ID],
  })
}

/**
 * MISSION_ACK(47): closes a successful pull. This bridge only ever sends
 * MAV_MISSION_ACCEPTED — an error ack is something the *vehicle* sends
 * (decoded in normalize.js), never something this bridge originates, since the
 * bridge never rejects a mission it merely reads.
 */
export function encodeMissionAck({ sysId, compId, targetSystemId, targetComponentId, type = MAV_MISSION_ACCEPTED }) {
  const payload = Buffer.alloc(3)
  payload.writeUInt8(targetSystemId, 0)
  payload.writeUInt8(targetComponentId, 1)
  payload.writeUInt8(type, 2)
  return buildMavlinkV1Frame(MISSION_ACK_MSG_ID, payload, {
    sequence: nextSequence(), sysId, compId, crcExtra: CRC_EXTRA[MISSION_ACK_MSG_ID],
  })
}

/**
 * Decode a MISSION_REQUEST_LIST or MISSION_REQUEST_INT v1 frame — the reverse of
 * this module's own encoders, used only by the mission mock responder
 * (sampleSender.js), which plays the vehicle's side of the handshake and needs to
 * read back what the bridge just sent it. Deliberately scoped to exactly these two
 * message IDs and to one frame per datagram (unlike normalize.js's general
 * multi-frame parser), since that is all the bridge ever sends per call.
 */
export function decodeMissionRequest(datagram) {
  if (datagram.length < 8 || datagram[0] !== MAVLINK_V1_MAGIC) {
    return null
  }

  const payloadLength = datagram[1]
  const msgId = datagram[5]
  const frameLength = payloadLength + 8

  if (datagram.length < frameLength || CRC_EXTRA[msgId] === undefined) {
    return null
  }

  const expectedCrc = datagram.readUInt16LE(frameLength - 2)
  const actualCrc = computeFrameCrc(datagram, 1, 6 + payloadLength, CRC_EXTRA[msgId])
  if (expectedCrc !== actualCrc) {
    return null
  }

  const payload = datagram.subarray(6, 6 + payloadLength)

  if (msgId === MISSION_REQUEST_LIST_MSG_ID) {
    return { messageName: 'MISSION_REQUEST_LIST' }
  }

  if (msgId === MISSION_REQUEST_INT_MSG_ID && payload.length >= 4) {
    return { messageName: 'MISSION_REQUEST_INT', seq: payload.readUInt16LE(0) }
  }

  return null
}
```

- [ ] **Step 2: Write `encode.test.js` — CRC-verified output for each encoder, plus the mock decoder round trip**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { computeFrameCrc } from './mavlinkFrame.js'
import {
  MAV_MISSION_ACCEPTED,
  decodeMissionRequest,
  encodeMissionAck,
  encodeMissionRequestInt,
  encodeMissionRequestList,
} from './encode.js'

test('encodeMissionRequestList produces a CRC-correct v1 frame addressing the target', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })

  assert.equal(frame[0], 0xFE)
  assert.equal(frame[1], 2) // payload length
  assert.equal(frame[3], 255) // sender sysId
  assert.equal(frame[4], 190) // sender compId
  assert.equal(frame[5], 43) // MISSION_REQUEST_LIST
  assert.equal(frame.readUInt8(6), 1) // target_system
  assert.equal(frame.readUInt8(7), 1) // target_component

  const expectedCrc = computeFrameCrc(frame, 1, 8, 132)
  assert.equal(frame.readUInt16LE(8), expectedCrc)
})

test('encodeMissionRequestInt carries the requested seq', () => {
  const frame = encodeMissionRequestInt({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, seq: 5 })
  const payload = frame.subarray(6, 10)
  assert.equal(payload.readUInt16LE(0), 5)
  assert.equal(payload.readUInt8(2), 1)
  assert.equal(payload.readUInt8(3), 1)

  const expectedCrc = computeFrameCrc(frame, 1, 10, 196)
  assert.equal(frame.readUInt16LE(10), expectedCrc)
})

test('encodeMissionAck defaults to MAV_MISSION_ACCEPTED', () => {
  const frame = encodeMissionAck({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  assert.equal(frame.readUInt8(8), MAV_MISSION_ACCEPTED)
})

test('decodeMissionRequest round-trips encodeMissionRequestList', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  assert.deepEqual(decodeMissionRequest(frame), { messageName: 'MISSION_REQUEST_LIST' })
})

test('decodeMissionRequest round-trips encodeMissionRequestInt, including seq', () => {
  const frame = encodeMissionRequestInt({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1, seq: 9 })
  assert.deepEqual(decodeMissionRequest(frame), { messageName: 'MISSION_REQUEST_INT', seq: 9 })
})

test('decodeMissionRequest rejects a corrupted CRC', () => {
  const frame = encodeMissionRequestList({ sysId: 255, compId: 190, targetSystemId: 1, targetComponentId: 1 })
  frame[6] ^= 0xFF // flip a payload byte without touching the CRC
  assert.equal(decodeMissionRequest(frame), null)
})
```

- [ ] **Step 3: Run the tests**

Run: `node --test src/encode.test.js` (from `apps/mavlink-bridge`)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/mavlink-bridge/src/encode.js apps/mavlink-bridge/src/encode.test.js
git commit -m "bridge: encode MISSION_REQUEST_LIST/INT and MISSION_ACK"
```

---

### Task 5: `udpIngress.js` gains a narrow `send`

**Files:**
- Modify: `apps/mavlink-bridge/src/udpIngress.js`
- Test: `apps/mavlink-bridge/src/udpIngress.test.js`

**Interfaces:**
- Produces: `send(buffer) -> boolean` on the object `createUdpIngress` returns (true if sent, false if no datagram has arrived yet to reply to). Consumed by Task 9 (`index.js`).

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'
import { createUdpIngress } from './udpIngress.js'

const TEST_HOST = '127.0.0.1'
const TEST_PORT = 19845 // arbitrary, loopback-only, unlikely to collide

/** Resend every 20ms until `promise` resolves — dodges the bind-race between the
 * ingress's socket coming up and the client's first send, without a fixed sleep. */
function sendUntil(client, buffer, port, host, promise) {
  const interval = setInterval(() => client.send(buffer, port, host), 20)
  return promise.finally(() => clearInterval(interval))
}

test('send() replies to whichever remote endpoint most recently sent a datagram', async () => {
  const ingress = createUdpIngress({ host: TEST_HOST, port: TEST_PORT })
  const client = dgram.createSocket('udp4')

  const receivedByIngress = new Promise((resolve) => {
    const stop = ingress.start((datagram, meta) => resolve({ datagram, meta, stop }))
  })

  await new Promise((resolve) => client.bind(0, TEST_HOST, resolve))
  const { stop } = await sendUntil(client, Buffer.from('hello'), TEST_PORT, TEST_HOST, receivedByIngress)

  const receivedByClient = new Promise((resolve) => client.once('message', resolve))
  const sent = ingress.send(Buffer.from('reply'))
  assert.equal(sent, true)

  const reply = await receivedByClient
  assert.equal(reply.toString(), 'reply')

  client.close()
  stop()
})

test('send() returns false when nothing has been received yet', () => {
  const ingress = createUdpIngress({ host: TEST_HOST, port: TEST_PORT + 1 })
  const stop = ingress.start(() => {})
  assert.equal(ingress.send(Buffer.from('x')), false)
  stop()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/udpIngress.test.js` (from `apps/mavlink-bridge`)
Expected: FAIL with `ingress.send is not a function`

- [ ] **Step 3: Implement `send()`**

Replace `apps/mavlink-bridge/src/udpIngress.js` in full:

```js
import dgram from 'node:dgram'

/** Inbound adapter: MAVLink datagrams off a UDP socket. Also the bridge's only
 * outbound path (see ADR-0027) — `send()` replies to whichever remote endpoint
 * most recently sent a datagram, since UDP is connectionless and "the vehicle" is,
 * in practice, whoever we last heard from (the same address:port bridgeCore.js
 * already tracks to detect a duplicate transmitter). */
export function createUdpIngress({ host, port }) {
  let socket = null
  let lastRemote = null

  return {
    describe: () => `udp ${host}:${port}`,

    start(onDatagram) {
      socket = dgram.createSocket('udp4')

      socket.on('message', (msg, rinfo) => {
        lastRemote = { address: rinfo.address, port: rinfo.port }
        onDatagram(msg, { source: `${rinfo.address}:${rinfo.port}` })
      })

      socket.on('error', (err) => {
        console.error(`[mavlink-bridge] UDP error: ${err.message}`)
      })

      socket.bind(port, host, () => {
        console.log(`[mavlink-bridge] udp listening on ${host}:${port}`)
      })

      return () => {
        socket.close()
        socket = null
      }
    },

    /** Returns false (and sends nothing) if no datagram has arrived yet — lets a
     * caller distinguish "nowhere to send" from "sent." */
    send(buffer) {
      if (socket === null || lastRemote === null) {
        return false
      }

      socket.send(buffer, lastRemote.port, lastRemote.address)
      return true
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/udpIngress.test.js` (from `apps/mavlink-bridge`)
Expected: PASS

- [ ] **Step 5: Run the full bridge suite, then commit**

Run: `npm run test --workspace @flight-path-hud/mavlink-bridge` — expect PASS.

```bash
git add apps/mavlink-bridge/src/udpIngress.js apps/mavlink-bridge/src/udpIngress.test.js
git commit -m "bridge: udpIngress gains send() — the bridge's first outbound path"
```

---

### Task 6: `missionSync.js` — the per-vehicle mission-pull state machine

**Files:**
- Create: `apps/mavlink-bridge/src/missionSync.js`
- Test: `apps/mavlink-bridge/src/missionSync.test.js`

**Interfaces:**
- Consumes: `encodeMissionRequestList`, `encodeMissionRequestInt`, `encodeMissionAck`, `MAV_MISSION_ACCEPTED` from `./encode.js` (Task 4).
- Produces: `createMissionSync({ send, now, sysId, compId, targetSystemId, targetComponentId }) -> { requestMission(), ingestEnvelope(envelope) -> boolean, tick(nowMs) -> boolean, acknowledgePublished(), getState() -> { status, reason, items, activeIndex } }`. `status` is one of `'idle'|'requested'|'collecting'|'complete'|'published'|'failed'`. Consumed by Task 8 (`missionRouter.js`).

This is the biggest single unit in this plan — the design doc's whole "State
machine", "Timeouts, retries, and known quirks" sections land here. `send`/`now`
are injected exactly like `bridgeCore.js`'s constructor, for the same reason:
deterministic tests with a fake clock and no real socket.

- [ ] **Step 1: Write the state-machine tests first**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { MAV_MISSION_ACCEPTED } from './encode.js'
import { createMissionSync } from './missionSync.js'

function makeSync(overrides = {}) {
  const sent = []
  let nowMs = 0
  const sync = createMissionSync({
    send: (buffer) => sent.push(buffer),
    now: () => nowMs,
    sysId: 255,
    compId: 190,
    targetSystemId: 1,
    targetComponentId: 1,
    ...overrides,
  })
  return { sync, sent, advance: (deltaMs) => { nowMs += deltaMs } }
}

function missionCountEnvelope(count) {
  return { sysId: 1, compId: 1, messageName: 'MISSION_COUNT', payload: { missionCount: { count } } }
}

function missionItemEnvelope(item) {
  return { sysId: 1, compId: 1, messageName: 'MISSION_ITEM_INT', payload: { missionItemInt: item } }
}

function missionAckEnvelope(type) {
  return { sysId: 1, compId: 1, messageName: 'MISSION_ACK', payload: { missionAck: { type } } }
}

test('idle until requestMission() is called', () => {
  const { sync } = makeSync()
  assert.equal(sync.getState().status, 'idle')
})

test('happy path: count=0 completes immediately with an ack, no items to fetch', () => {
  const { sync, sent } = makeSync()
  sync.requestMission()
  assert.equal(sync.getState().status, 'requested')
  assert.equal(sent.length, 1) // MISSION_REQUEST_LIST

  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.getState().status, 'complete')
  assert.deepEqual(sync.getState().items, [])
  assert.equal(sent.length, 2) // + MISSION_ACK
})

test('happy path: two items collected in order, then acked', () => {
  const { sync, sent } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(2))
  assert.equal(sync.getState().status, 'collecting')
  assert.equal(sent.length, 2) // MISSION_REQUEST_LIST + MISSION_REQUEST_INT(seq=0)

  sync.ingestEnvelope(missionItemEnvelope({ seq: 0, command: 16, current: false, autocontinue: true, latDegE7: 1, lonDegE7: 2, altM: 3 }))
  assert.equal(sync.getState().status, 'collecting')
  assert.equal(sent.length, 3) // + MISSION_REQUEST_INT(seq=1)

  sync.ingestEnvelope(missionItemEnvelope({ seq: 1, command: 17, current: true, autocontinue: true, latDegE7: 4, lonDegE7: 5, altM: 6 }))
  assert.equal(sync.getState().status, 'complete')
  assert.equal(sent.length, 4) // + MISSION_ACK
  assert.equal(sync.getState().items.length, 2)
  assert.equal(sync.getState().items[1].seq, 1)
})

test('acknowledgePublished() moves complete -> published, and is a no-op otherwise', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.getState().status, 'complete')

  sync.acknowledgePublished()
  assert.equal(sync.getState().status, 'published')

  sync.acknowledgePublished() // already published — no-op, doesn't throw
  assert.equal(sync.getState().status, 'published')
})

test('out-of-sequence item is dropped and the expected index is re-requested', () => {
  const { sync, sent } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(2))
  const sentBefore = sent.length

  sync.ingestEnvelope(missionItemEnvelope({ seq: 1, command: 1, current: false, autocontinue: true, latDegE7: 0, lonDegE7: 0, altM: 0 }))
  assert.equal(sync.getState().status, 'collecting', 'still waiting for seq 0')
  assert.equal(sent.length, sentBefore + 1, 'one re-request sent')
  assert.equal(sync.getState().items.length, 0, 'nothing recorded')
})

test('MISSION_CURRENT updates activeIndex passively, independent of pull status', () => {
  const { sync } = makeSync()
  sync.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'MISSION_CURRENT', payload: { missionCurrent: { seq: 3 } } })
  assert.equal(sync.getState().activeIndex, 3)
  assert.equal(sync.getState().status, 'idle', 'a status-changing message this is not')
})

test('a spurious MAV_MISSION_INVALID_SEQUENCE ack mid-flight is ignored (ArduPilot quirk)', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))

  sync.ingestEnvelope(missionAckEnvelope(13)) // MAV_MISSION_INVALID_SEQUENCE
  assert.equal(sync.getState().status, 'collecting', 'not treated as fatal')
})

test('any other MAV_MISSION_RESULT error is unrecoverable', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))

  sync.ingestEnvelope(missionAckEnvelope(1)) // MAV_MISSION_ERROR
  const state = sync.getState()
  assert.equal(state.status, 'failed')
  assert.match(state.reason, /MAV_MISSION_RESULT=1/)
})

test('retries MISSION_REQUEST_INT on a 250ms timeout, up to 5 times, then fails', () => {
  const { sync, sent, advance } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))
  const sentAfterFirstRequest = sent.length

  for (let retry = 1; retry <= 5; retry += 1) {
    advance(250)
    const changed = sync.tick()
    assert.equal(changed, true, `retry ${retry} should re-send`)
  }
  assert.equal(sent.length, sentAfterFirstRequest + 5)
  assert.equal(sync.getState().status, 'collecting', 'still within budget after 5 retries')

  advance(250)
  sync.tick()
  assert.equal(sync.getState().status, 'failed')
  assert.match(sync.getState().reason, /timed out/)
})

test('retries MISSION_REQUEST_LIST on a 1500ms timeout while awaiting MISSION_COUNT', () => {
  const { sync, sent, advance } = makeSync()
  sync.requestMission()
  const sentAfterFirstRequest = sent.length

  advance(1500)
  assert.equal(sync.tick(), true)
  assert.equal(sent.length, sentAfterFirstRequest + 1)
  assert.equal(sync.getState().status, 'requested')
})

test('tick() is a no-op before any request and after completion', () => {
  const { sync } = makeSync()
  assert.equal(sync.tick(), false)

  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(0))
  assert.equal(sync.tick(), false, 'nothing outstanding once complete')
})

test('requestMission() after a failure starts a fresh attempt', () => {
  const { sync } = makeSync()
  sync.requestMission()
  sync.ingestEnvelope(missionCountEnvelope(1))
  sync.ingestEnvelope(missionAckEnvelope(1)) // fail it
  assert.equal(sync.getState().status, 'failed')

  sync.requestMission()
  assert.equal(sync.getState().status, 'requested')
  assert.equal(sync.getState().reason, null)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/missionSync.test.js` (from `apps/mavlink-bridge`)
Expected: FAIL — `createMissionSync` does not exist yet.

- [ ] **Step 3: Implement `missionSync.js`**

```js
import { MAV_MISSION_ACCEPTED, encodeMissionAck, encodeMissionRequestInt, encodeMissionRequestList } from './encode.js'

// MAV_MISSION_RESULT value the vehicle sends unsolicited on a real, ArduPilot-observed
// quirk: a stray INVALID_SEQUENCE ack while items are still in flight. Carried over
// from QGroundControl's PlanManager, which treats it the same way (ignore, not fatal).
const MAV_MISSION_INVALID_SEQUENCE = 13

// QGroundControl's PlanManager.h timeouts/retries — not invented (design doc §2).
export const MISSION_COUNT_TIMEOUT_MS = 1500
export const MISSION_ITEM_TIMEOUT_MS = 250
export const MAX_RETRIES = 5

/**
 * One vehicle's mission-pull state machine, transport-agnostic like bridgeCore.js:
 * fed decoded envelopes and a `now`/`send` seam, no socket or timer of its own.
 *
 *   idle -> requested (sent MISSION_REQUEST_LIST)
 *        -> collecting (sent MISSION_REQUEST_INT per index; tracks the next expected one)
 *        -> complete (all items in; MISSION_ACK sent) -> published (via acknowledgePublished())
 *   (any state) -> failed (retries exhausted / unrecoverable MISSION_ACK)
 *
 * `acknowledgePublished()` exists so this module never has to know what "publish"
 * means — the router (missionRouter.js) calls it once it has actually broadcast the
 * 'complete' snapshot, which is what actually closes the loop to 'published'.
 */
export function createMissionSync({ send, now = Date.now, sysId, compId, targetSystemId, targetComponentId }) {
  let status = 'idle'
  let reason = null
  let expectedCount = null
  let items = []
  let nextSeq = 0
  let retryCount = 0
  let awaitingSince = null
  let activeIndex = null

  function sendRequestList() {
    send(encodeMissionRequestList({ sysId, compId, targetSystemId, targetComponentId }))
    awaitingSince = now()
  }

  function sendRequestItem(seq) {
    send(encodeMissionRequestInt({ sysId, compId, targetSystemId, targetComponentId, seq }))
    awaitingSince = now()
  }

  function sendAck(type) {
    send(encodeMissionAck({ sysId, compId, targetSystemId, targetComponentId, type }))
  }

  function fail(failureReason) {
    status = 'failed'
    reason = failureReason
    expectedCount = null
    items = []
    nextSeq = 0
    retryCount = 0
    awaitingSince = null
  }

  return {
    requestMission() {
      status = 'requested'
      reason = null
      expectedCount = null
      items = []
      nextSeq = 0
      retryCount = 0
      sendRequestList()
    },

    /** Returns whether this envelope actually changed observable state, so the
     * router only rebuilds/republishes a wire frame when something moved. */
    ingestEnvelope(envelope) {
      const { messageName, payload } = envelope

      if (messageName === 'MISSION_CURRENT') {
        activeIndex = payload.missionCurrent.seq
        return true
      }

      if (messageName === 'MISSION_COUNT' && status === 'requested') {
        expectedCount = payload.missionCount.count
        retryCount = 0

        if (expectedCount === 0) {
          items = []
          sendAck(MAV_MISSION_ACCEPTED)
          status = 'complete'
          return true
        }

        items = new Array(expectedCount)
        nextSeq = 0
        status = 'collecting'
        sendRequestItem(0)
        return true
      }

      if (messageName === 'MISSION_ITEM_INT' && status === 'collecting') {
        const item = payload.missionItemInt

        if (item.seq !== nextSeq) {
          // Recoverable per spec: drop it, re-ask for the index we actually want.
          sendRequestItem(nextSeq)
          return true
        }

        items[nextSeq] = item
        nextSeq += 1
        retryCount = 0

        if (nextSeq >= expectedCount) {
          sendAck(MAV_MISSION_ACCEPTED)
          status = 'complete'
          return true
        }

        sendRequestItem(nextSeq)
        return true
      }

      if (messageName === 'MISSION_ACK' && status === 'collecting') {
        const { type } = payload.missionAck

        if (type === MAV_MISSION_INVALID_SEQUENCE) {
          // ArduPilot quirk, carried over from QGC: spurious while in flight, not fatal.
          return false
        }

        if (type !== MAV_MISSION_ACCEPTED) {
          fail(`vehicle rejected mission pull (MAV_MISSION_RESULT=${type})`)
          return true
        }

        return false
      }

      return false
    },

    /** Drives the retry/timeout budget. Returns whether it actually changed state
     * (a re-request or a failure) — a bare "still waiting" tick returns false. */
    tick(nowMs = now()) {
      if (awaitingSince === null) {
        return false
      }

      const timeoutMs = status === 'requested' ? MISSION_COUNT_TIMEOUT_MS : MISSION_ITEM_TIMEOUT_MS
      if (nowMs - awaitingSince < timeoutMs) {
        return false
      }

      retryCount += 1
      if (retryCount > MAX_RETRIES) {
        const waitingFor = status === 'requested' ? 'MISSION_COUNT' : `MISSION_ITEM_INT(seq=${nextSeq})`
        fail(`timed out waiting for ${waitingFor} after ${MAX_RETRIES} retries`)
        return true
      }

      if (status === 'requested') {
        sendRequestList()
      } else if (status === 'collecting') {
        sendRequestItem(nextSeq)
      }

      return true
    },

    /** Call once the router has actually broadcast a 'complete' snapshot. */
    acknowledgePublished() {
      if (status === 'complete') {
        status = 'published'
      }
    },

    getState() {
      return {
        status,
        reason,
        items: items.filter((item) => item !== undefined),
        activeIndex,
      }
    },
  }
}
```

Note: `ingestEnvelope` returns `false` for the ignored-spurious-ack and
accepted-ack-not-yet-complete cases above — neither changes anything a wire frame
would need to reflect, unlike the earlier draft's tests assumed pure "did status
change." Re-run Step 1's tests against this exact implementation before moving on;
if any assertion on the `false`-returning paths existed in your working copy of the
test file, prefer this implementation's behavior (matching what the router in
Task 8 actually needs) and adjust the test's expectation rather than the code.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/missionSync.test.js` (from `apps/mavlink-bridge`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mavlink-bridge/src/missionSync.js apps/mavlink-bridge/src/missionSync.test.js
git commit -m "bridge: missionSync — the mission-pull state machine"
```

---

### Task 7: A real binary mission mock in `sampleSender.js`

**Files:**
- Modify: `apps/mavlink-bridge/src/sampleSender.js`

**Interfaces:**
- Consumes: `decodeMissionRequest` from `./encode.js` (Task 4); `encodeMissionCount`, `encodeMissionItemInt` from `./normalize.js` (Task 3).
- Produces: a UDP responder that decodes real `MISSION_REQUEST_LIST`/`MISSION_REQUEST_INT` frames and replies with real, CRC'd `MISSION_COUNT`/`MISSION_ITEM_INT` frames — no JSON shortcut, per design doc §6.

The mock is stateless: every `MISSION_REQUEST_LIST` gets the same fixed
three-waypoint mission's count, and every `MISSION_REQUEST_INT(seq)` gets that
item, regardless of what came before. No handshake tracking needed on this side.

- [ ] **Step 1: Add the fixed mock mission and the responder, wired into the existing socket**

`sampleSender.js` already binds one socket (`LOCK_PORT`) that only sends today. Add
a `message` handler to the same socket, plus the mission data and reply logic.
Insert after the existing `const ORIGIN = ...` block:

```js
import { decodeMissionRequest } from './encode.js'
import { encodeMissionCount, encodeMissionItemInt } from './normalize.js'

// A fixed 3-waypoint mission near ORIGIN, offset a few hundred metres each way so
// it's visually distinct from the flight path on the map.
const MOCK_MISSION = [
  { seq: 0, command: 16, current: true, autocontinue: true, frameId: 3, latDegE7: ORIGIN.latDegE7 + 2000, lonDegE7: ORIGIN.lonDegE7 + 2000, altM: 80 },
  { seq: 1, command: 16, current: false, autocontinue: true, frameId: 3, latDegE7: ORIGIN.latDegE7 + 4000, lonDegE7: ORIGIN.lonDegE7 - 1000, altM: 100 },
  { seq: 2, command: 16, current: false, autocontinue: true, frameId: 3, latDegE7: ORIGIN.latDegE7 + 1000, lonDegE7: ORIGIN.lonDegE7 - 3000, altM: 60 },
]

const MOCK_VEHICLE_SYS_ID = 1
const MOCK_VEHICLE_COMP_ID = 1

/** Plays the vehicle's side of the mission handshake: decode what the bridge just
 * sent, reply with a real, CRC'd response. No state kept across calls — every
 * request gets answered from MOCK_MISSION fresh, matching how a real autopilot
 * would answer the same request twice identically. */
function handleMissionRequest(datagram, rinfo) {
  const request = decodeMissionRequest(datagram)
  if (request === null) {
    return
  }

  if (request.messageName === 'MISSION_REQUEST_LIST') {
    const frame = encodeMissionCount({ sysId: MOCK_VEHICLE_SYS_ID, compId: MOCK_VEHICLE_COMP_ID, count: MOCK_MISSION.length })
    socket.send(frame, rinfo.port, rinfo.address)
    return
  }

  if (request.messageName === 'MISSION_REQUEST_INT') {
    const item = MOCK_MISSION[request.seq]
    if (item === undefined) {
      return
    }
    const frame = encodeMissionItemInt({ sysId: MOCK_VEHICLE_SYS_ID, compId: MOCK_VEHICLE_COMP_ID, item })
    socket.send(frame, rinfo.port, rinfo.address)
  }
}

socket.on('message', (datagram, rinfo) => {
  handleMissionRequest(datagram, rinfo)
})
```

Place the `socket.on('message', ...)` registration after `const socket =
dgram.createSocket('udp4')` and before `socket.bind(LOCK_PORT, ...)` — mirroring
where the existing `socket.on('error', ...)` handler already sits.

- [ ] **Step 2: Manually verify against the real bridge**

This is a script, not a unit — verified by running the real stack, same as the
rest of `sampleSender.js`'s existing (test-free) convention.

```bash
npm run start:bridge &
npm run sample:bridge &
```

Then, from a scratch file or a Node REPL, connect a WebSocket client to
`ws://localhost:8080/telemetry`, send `{"type":"requestMission","sysId":1,"compId":1}`,
and confirm a `mission` frame with `status: 'complete'` and 3 items arrives.
(This full path isn't wired up until Task 9 — come back to this verification step
after Task 9 is done, not now. It's listed here because this is the task that made
the mock exist; Task 9's own verification step will point back to it.)

- [ ] **Step 3: Commit**

```bash
git add apps/mavlink-bridge/src/sampleSender.js
git commit -m "bridge: sampleSender replies to real mission-pull requests"
```

---

### Task 8: `missionRouter.js` — the transport-agnostic integration point

**Files:**
- Create: `apps/mavlink-bridge/src/missionRouter.js`
- Test: `apps/mavlink-bridge/src/missionRouter.test.js`

**Interfaces:**
- Consumes: `createMissionSync` from `./missionSync.js` (Task 6).
- Produces: `createMissionRouter({ send, canSend, now }) -> { ingestEnvelope(envelope) -> frame|null, handleClientMessage(message) -> frame|null, tick(nowMs) -> frame[], snapshotForNewClient() -> frame[] }`. Consumed by Task 9 (`index.js`).

This is the module that turns "a decoded envelope, a client message, or a tick"
into the exact wire frames `index.js` broadcasts — one `missionSync` per system,
a last-known cache for the "send state on connect" persistence design (§4), and
the `MISSION_MESSAGE_NAMES` filter that keeps mission/home traffic off the regular
per-message telemetry broadcast (those get a `mission`/`home` frame instead, never
the raw envelope — see this plan's Global Constraints).

- [ ] **Step 1: Write the tests first**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMissionRouter } from './missionRouter.js'

function makeRouter(overrides = {}) {
  const sent = []
  let canSendValue = true
  let nowMs = 0
  const router = createMissionRouter({
    send: (buffer) => sent.push(buffer),
    canSend: () => canSendValue,
    now: () => nowMs,
    ...overrides,
  })
  return {
    router, sent,
    setCanSend: (value) => { canSendValue = value },
    advance: (deltaMs) => { nowMs += deltaMs },
  }
}

test('HOME_POSITION becomes a home frame and is cached for new clients', () => {
  const { router } = makeRouter()
  const frame = router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'HOME_POSITION',
    payload: { homePosition: { latDegE7: 473977420, lonDegE7: 85455940, altMm: 500000 } },
  })

  assert.equal(frame.type, 'home')
  assert.equal(frame.sysId, 1)
  assert.equal(frame.lat.toFixed(6), '47.397742')
  assert.equal(frame.altMslM, 500)
  assert.deepEqual(router.snapshotForNewClient(), [frame])
})

test('a non-mission, non-home envelope is ignored', () => {
  const { router } = makeRouter()
  const frame = router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'HEARTBEAT', payload: {} })
  assert.equal(frame, null)
})

test('handleClientMessage triggers a pull and returns a pending frame', () => {
  const { router, sent } = makeRouter()
  const frame = router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  assert.equal(frame.type, 'mission')
  assert.equal(frame.status, 'pending')
  assert.equal(frame.items.length, 0)
  assert.equal(sent.length, 1) // MISSION_REQUEST_LIST went out
})

test('a full pull ends with status complete, scaled lat/lon/alt, then acknowledgePublished flips it to published internally', () => {
  const { router } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'MISSION_COUNT', payload: { missionCount: { count: 1 } } })
  const frame = router.ingestEnvelope({
    sysId: 1, compId: 1, messageName: 'MISSION_ITEM_INT',
    payload: { missionItemInt: { seq: 0, command: 16, current: true, autocontinue: true, latDegE7: 473977420, lonDegE7: 85455940, altM: 80 } },
  })

  assert.equal(frame.status, 'complete')
  assert.equal(frame.items.length, 1)
  assert.equal(frame.items[0].latDeg.toFixed(6), '47.397742')
  assert.equal(frame.items[0].altM, 80)

  // Idempotent: ingesting nothing new (a tick with nothing outstanding) never re-fires.
  assert.deepEqual(router.tick(), [])
})

test('handleClientMessage fails immediately when canSend() is false (replay mode)', () => {
  const { router, setCanSend, sent } = makeRouter()
  setCanSend(false)

  const frame = router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })
  assert.equal(frame.status, 'failed')
  assert.match(frame.reason, /replay/i)
  assert.equal(sent.length, 0, 'no outbound bytes in replay mode')
})

test('handleClientMessage ignores a message of the wrong type', () => {
  const { router } = makeRouter()
  assert.equal(router.handleClientMessage({ type: 'somethingElse' }), null)
  assert.equal(router.handleClientMessage(null), null)
})

test('tick() surfaces a timeout failure as a frame', () => {
  const { router, advance } = makeRouter()
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  advance(1500 * 6) // past MISSION_COUNT_TIMEOUT_MS * (MAX_RETRIES + 1)
  const frames = router.tick()
  assert.equal(frames.length, 1)
  assert.equal(frames[0].status, 'failed')
})

test('snapshotForNewClient includes both mission and home state across systems', () => {
  const { router } = makeRouter()
  router.ingestEnvelope({ sysId: 1, compId: 1, messageName: 'HOME_POSITION', payload: { homePosition: { latDegE7: 1, lonDegE7: 1, altMm: 1000 } } })
  router.handleClientMessage({ type: 'requestMission', sysId: 1, compId: 1 })

  const snapshot = router.snapshotForNewClient()
  assert.equal(snapshot.length, 2)
  assert.deepEqual(snapshot.map((frame) => frame.type).sort(), ['home', 'mission'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/missionRouter.test.js` (from `apps/mavlink-bridge`)
Expected: FAIL — `createMissionRouter` does not exist yet.

- [ ] **Step 3: Implement `missionRouter.js`**

```js
import { createMissionSync } from './missionSync.js'

const MISSION_MESSAGE_NAMES = new Set(['MISSION_COUNT', 'MISSION_ITEM_INT', 'MISSION_CURRENT', 'MISSION_ACK'])

// QGroundControl-style GCS identity, used as this bridge's own sysId/compId in
// every outbound frame header. Overridable in case a deployment needs a specific
// identity to avoid colliding with another GCS on the same link.
const GCS_SYSTEM_ID = Number.parseInt(process.env.MAVLINK_BRIDGE_GCS_SYSTEM_ID ?? '255', 10)
const GCS_COMPONENT_ID = Number.parseInt(process.env.MAVLINK_BRIDGE_GCS_COMPONENT_ID ?? '190', 10)

function systemKey(sysId, compId) {
  return `${sysId}:${compId}`
}

function toWireStatus(internalStatus) {
  if (internalStatus === 'requested' || internalStatus === 'collecting') {
    return 'pending'
  }
  if (internalStatus === 'complete' || internalStatus === 'published') {
    return 'complete'
  }
  return 'failed'
}

function toWireItem(item) {
  return {
    seq: item.seq,
    command: item.command,
    current: item.current,
    autocontinue: item.autocontinue,
    latDeg: item.latDegE7 / 1e7,
    lonDeg: item.lonDegE7 / 1e7,
    altM: item.altM,
  }
}

/**
 * Transport-agnostic multi-vehicle router, like bridgeCore.js: fed decoded
 * envelopes and parsed client messages, emits the frames index.js should
 * broadcast. Owns the per-system missionSync instances and the last-known
 * mission/home cache that lets a late-connecting client see state immediately
 * (design doc §4) instead of waiting for the next natural event.
 */
export function createMissionRouter({ send, canSend, now = Date.now }) {
  const syncs = new Map()
  const missionCache = new Map()
  const homeCache = new Map()

  function syncFor(sysId, compId) {
    const key = systemKey(sysId, compId)
    let sync = syncs.get(key)

    if (sync === undefined) {
      sync = createMissionSync({
        send, now,
        sysId: GCS_SYSTEM_ID, compId: GCS_COMPONENT_ID,
        targetSystemId: sysId, targetComponentId: compId,
      })
      syncs.set(key, sync)
    }

    return sync
  }

  function missionFrameFor(sysId, compId, sync) {
    const state = sync.getState()
    const frame = {
      type: 'mission',
      sysId,
      compId,
      status: toWireStatus(state.status),
      items: state.items.map(toWireItem),
      activeIndex: state.activeIndex,
      reason: state.reason,
    }
    missionCache.set(systemKey(sysId, compId), frame)

    if (state.status === 'complete') {
      sync.acknowledgePublished()
    }

    return frame
  }

  return {
    ingestEnvelope(envelope) {
      const { sysId, compId, messageName, payload } = envelope

      if (messageName === 'HOME_POSITION') {
        const frame = {
          type: 'home',
          sysId,
          compId,
          lat: payload.homePosition.latDegE7 / 1e7,
          lon: payload.homePosition.lonDegE7 / 1e7,
          altMslM: payload.homePosition.altMm / 1000,
        }
        homeCache.set(systemKey(sysId, compId), frame)
        return frame
      }

      if (!MISSION_MESSAGE_NAMES.has(messageName)) {
        return null
      }

      const sync = syncFor(sysId, compId)
      const changed = sync.ingestEnvelope(envelope)
      return changed ? missionFrameFor(sysId, compId, sync) : null
    },

    handleClientMessage(message) {
      if (message === null || typeof message !== 'object' || message.type !== 'requestMission') {
        return null
      }

      const { sysId, compId } = message

      if (!canSend()) {
        const frame = { type: 'mission', sysId, compId, status: 'failed', items: [], activeIndex: null, reason: 'replay mode: no live vehicle to query' }
        missionCache.set(systemKey(sysId, compId), frame)
        return frame
      }

      const sync = syncFor(sysId, compId)
      sync.requestMission()
      return missionFrameFor(sysId, compId, sync)
    },

    tick(nowMs = now()) {
      const frames = []

      syncs.forEach((sync, key) => {
        if (sync.tick(nowMs)) {
          const [sysId, compId] = key.split(':').map(Number)
          frames.push(missionFrameFor(sysId, compId, sync))
        }
      })

      return frames
    },

    snapshotForNewClient() {
      return [...missionCache.values(), ...homeCache.values()]
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/missionRouter.test.js` (from `apps/mavlink-bridge`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mavlink-bridge/src/missionRouter.js apps/mavlink-bridge/src/missionRouter.test.js
git commit -m "bridge: missionRouter — multi-vehicle mission/home routing and last-known cache"
```

---

### Task 9: Wire `missionRouter` into `index.js`

**Files:**
- Modify: `apps/mavlink-bridge/src/index.js`

**Interfaces:**
- Consumes: `createMissionRouter` (Task 8), `ingress.send` (Task 5, present only on `udpIngress`, absent on `replayIngress`).
- Produces: the running bridge end to end. No new automated test — `index.js` has never had one (it only wires real sockets), matching this file's existing untested-script convention. Verified manually.

- [ ] **Step 1: Import and construct the router**

Add near the top, after the existing imports:

```js
import { createMissionRouter } from './missionRouter.js'
```

After `const core = createBridgeCore({ systemTtlMs: SYSTEM_TTL_MS })` and after
`const ingress = ...` is assigned (the router needs to know whether `ingress.send`
exists, which is only true post-assignment):

```js
const missionRouter = createMissionRouter({
  send: (buffer) => ingress.send?.(buffer),
  canSend: () => typeof ingress.send === 'function',
})

const MISSION_MESSAGE_NAMES = new Set(['MISSION_COUNT', 'MISSION_ITEM_INT', 'MISSION_CURRENT', 'MISSION_ACK'])
```

- [ ] **Step 2: Route mission/home envelopes away from the raw telemetry broadcast**

Replace this line inside the `ingress.start(...)` callback:

```js
  core.ingestDatagram(datagram, undefined, meta?.source).forEach(publish)
```

with:

```js
  core.ingestDatagram(datagram, undefined, meta?.source).forEach((envelope) => {
    if (envelope.messageName === 'HOME_POSITION' || MISSION_MESSAGE_NAMES.has(envelope.messageName)) {
      const frame = missionRouter.ingestEnvelope(envelope)
      if (frame !== null) {
        publish(frame)
      }
      return
    }

    publish(envelope)
  })
```

(`core.ingestDatagram` still runs first and unconditionally, so message-rate
counters and system-roster tracking are unaffected — only the *publish* path
branches.)

- [ ] **Step 3: Send cached state and link mode to each newly-connected client**

Replace:

```js
wsServer.on('connection', () => {
  console.log(`[mavlink-bridge] websocket client connected (${wsServer.clients.size} clients, ${core.systemCount()} systems seen)`)
})
```

with:

```js
wsServer.on('connection', (ws) => {
  console.log(`[mavlink-bridge] websocket client connected (${wsServer.clients.size} clients, ${core.systemCount()} systems seen)`)

  ws.send(JSON.stringify({ type: 'linkMode', replayMode: REPLAY_FILE !== null }))
  missionRouter.snapshotForNewClient().forEach((frame) => ws.send(JSON.stringify(frame)))

  ws.on('message', (raw) => {
    let message = null
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    const frame = missionRouter.handleClientMessage(message)
    if (frame !== null) {
      publish(frame)
    }
  })
})
```

- [ ] **Step 4: Drive the retry/timeout budget on its own faster tick**

The existing 1000ms `tickTimer` is too coarse for the 250ms per-item timeout. Add a
second interval near it:

```js
const missionTickTimer = setInterval(() => {
  missionRouter.tick().forEach(publish)
}, 100)
```

And clear it in `shutdown()`, alongside the existing `clearInterval(tickTimer)`:

```js
async function shutdown() {
  clearInterval(tickTimer)
  clearInterval(missionTickTimer)
  stopIngress()
  await recorder?.close()
  wsServer.close()
  process.exit(0)
}
```

- [ ] **Step 5: Manual end-to-end verification**

```bash
npm run start:bridge &
npm run sample:bridge &
```

From a scratch Node script (or `node -e`) using the `ws` package already in this
workspace's dependencies:

```js
import WebSocket from 'ws'
const socket = new WebSocket('ws://localhost:8080/telemetry')
socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'requestMission', sysId: 1, compId: 1 }))
})
socket.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.type === 'mission' || msg.type === 'home' || msg.type === 'linkMode') {
    console.log(msg)
  }
})
```

Expected: a `linkMode` frame with `replayMode: false` immediately on connect, then
(after sending `requestMission`) a `mission` frame with `status: 'pending'`
followed by one with `status: 'complete'` and 3 items matching `MOCK_MISSION`
from Task 7, and periodically a `home` frame once `HOME_POSITION` starts arriving
(note: `sampleSender.js` does not currently emit `HOME_POSITION` — that's fine,
the `home` path stays untriggered in this dev setup and is exercised by
`missionRouter.test.js`'s unit test instead).

Also verify replay-mode gating:

```bash
MAVLINK_BRIDGE_REPLAY_FILE=apps/mavlink-bridge/recordings/<any-existing-file>.jsonl npm run replay:bridge
```

Send the same `requestMission` message; expect an immediate `mission` frame with
`status: 'failed'`, `reason` mentioning replay mode, and confirm no UDP send is
attempted (no `send is not a function` crash, since `canSend()` gates it first).

- [ ] **Step 6: Run the full bridge test suite one more time**

Run: `npm run test --workspace @flight-path-hud/mavlink-bridge`
Expected: PASS (everything from Tasks 2–8 still green; `index.js` itself stays
outside the automated suite, per this file's existing convention).

- [ ] **Step 7: Commit**

```bash
git add apps/mavlink-bridge/src/index.js
git commit -m "bridge: wire missionRouter into index.js — Load Mission works end to end"
```

