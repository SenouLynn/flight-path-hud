# Go bridge open-question audit

## Resolved in Phases B–D

### OQ-001 — internal versus public normalized envelopes

- **Decision:** separate strict boundaries. `normalized-envelope.schema.json`
  describes health-free JSON ingress, `core-envelope.schema.json` describes all
  15 normalized core families with health, and `telemetry-frame.schema.json`
  describes exactly the eight raw families published by protocol v0.
- **Observable result:** the runtime shape did not change. `publishPolicy.js`
  makes the existing suppression of HOME_POSITION and six mission families
  countable and testable. Every raw public envelope requires health; lifecycle,
  mission, home, and flight-state schemas remain distinct.
- **Evidence:** all three schemas, their valid/invalid fixtures,
  `portableContracts.test.ts`, and `publishPolicy.test.js`.

### OQ-002 — malformed supported-frame accounting

- **Decision:** supported MAVLink v1 uses the exact dialect minimum length;
  unsigned v2 accepts one through the dialect maximum and zero-expands legal
  trailing truncation. Bad CRC, incomplete candidates, invalid supported
  lengths, and signed v2 each count exactly one decode/drop. Complete unsupported
  IDs are ignored because their CRC extra is unavailable.
- **Observable result:** Node was hardened first, then Go was matched. Noise can
  resynchronize to a later valid prefix; noise-only input counts once.
- **Evidence:** `normalization-frame-vectors.json`, consumed directly by both
  Node and Go, pins the audited common-dialect hash, all 15 message definitions,
  15 nonzero normalized payloads, every length boundary, and malformed cases.

### OQ-003 — arbitrary JSON-envelope passthrough

- **Decision:** JSON datagram ingress must conform to the strict 15-family
  normalized-envelope contract. Identity and sequence are uint8 values and are
  preserved, timestamps are finite, family/payload correlation is exact, and
  extra fields are rejected.
- **Observable result:** invalid or unknown JSON publishes nothing and contributes
  exactly one decode/drop through the core. Mock, replay, and fixed-clock inputs
  were updated to complete valid shapes.
- **Evidence:** normalized-envelope valid/invalid fixtures plus Node and Go
  conformance tests.

## Phase gate audits

- **Phase B:** audited the three envelope boundaries, the exact `index.js`
  publish/suppression set, all 15 decoders, common-dialect length/CRC metadata,
  strict JSON ingress, health/counters, per-core sequence fallback, roster/TTL,
  rates, and source conflicts. **Unresolved questions: none found.**
- **Phase C:** audited exact-target routes, both repository JSONL recordings,
  raw/event dispatch, the no-send/no-timer replay API, and explicit `atMs` core
  folding. **Unresolved questions: none found.**
- **Phase D:** audited parameter vectors, read/list semantic traces, lifecycle
  schemas, exact-target PARAM_VALUE correlation, retries, route loss, passive
  events, and the absence of a process-lifetime result cache. **Unresolved
  questions: none found.**

## Intentionally deferred decisions (not blocking Phases A–D)

- Signed MAVLink v2 verification/support; this slice rejects signed candidates.
- Bounded live snapshot retention, queue/connection byte limits, global GCS
  identity, live clock policy, and WebSocket dependency selection.
- A provenanced live raw-plus-lifecycle parameter-list capture. Phase D's list
  implementation evidence remains `partial` until later SITL work produces it.
