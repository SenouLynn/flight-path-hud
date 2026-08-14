# Go bridge open questions

## OQ-001 — normalized/published envelopes conflict with the strict telemetry schema

- **Affected contract/symbols:** `contracts/wire/telemetry-frame.schema.json`,
  `contracts/wire/envelope.schema.json`, `createBridgeCore`, and the Phase B
  15-family normalization/publish requirement.
- **Evidence:**
  `contracts/fixtures/open/bridge-core-telemetry-schema-conflict.json` contains
  two minimal cases. The strict schema forbids the core's top-level `health` and
  models only ATTITUDE, VFR_HUD, GLOBAL_POSITION_INT, and GPS_RAW_INT payloads.
  The Node runtime publishes core envelopes for additional normalized families,
  including HEARTBEAT, PARAM_VALUE, and COMMAND_ACK.
- **Why authority does not resolve it:** language-neutral schemas outrank Node,
  but the handoff separately requires protocol-v0 Node output parity, health on
  every envelope, and all 15 normalized families. Satisfying either side without
  a contract decision violates another explicit requirement.
- **Safe options:**
  1. Expand the strict producer schema to model health and every actually
     published raw family. This codifies current Node output and widens the
     portable producer contract.
  2. Define a separate internal normalized-envelope contract and constrain the
     public envelope schema/publish policy. This may require suppressing or
     transforming currently published protocol-v0 frames.
  3. Explicitly classify the strict schema as a selected consumer subset rather
     than the producer boundary, then add a distinct full producer schema. This
     changes the current contract-pack compatibility statement.
- **Blocked phase:** Phase B's output-parity gate. Phase C fixed-core comparison
  and Phase D end-to-end PARAM_VALUE path cannot be called complete until the
  public/internal envelope boundary is selected.

## OQ-002 — malformed supported-frame accounting is undefined across authorities

- **Affected contract/symbols:** `parseIncomingDatagram`, Phase B's malformed and
  truncation requirements, and `CORE-HEALTH` decode/drop counters.
- **Evidence:** Node increments `decodeErrors` for a truncated whole frame or bad
  CRC, but a CRC-valid supported frame whose decoder rejects a short payload is
  silently dropped. Several padded decoders also accept nonempty short MAVLink v1
  payloads. Valid unsupported message IDs are silently ignored without CRC
  validation. No language-neutral negative cases define these distinctions.
- **Why authority does not resolve it:** schemas do not define byte-decoder error
  accounting, and the handoff requires malformed decoder errors while Node—the
  remaining authority—is observably inconsistent by message family.
- **Safe options:**
  1. Add dialect-derived negative vectors that define corruption, unsupported
     messages, v1 short payloads, and legitimate v2 trailing-zero truncation,
     then align Node and Go in a separately reviewed compatibility change.
  2. Preserve each current Node case exactly and document the uneven accounting
     as protocol-v0 behavior. This retains malformed-v1 acceptance and makes
     health semantics implementation-specific.
- **Blocked phase:** Phase B decoder/core completion and any Phase C comparison
  that claims decode/drop-counter parity for malformed input.

## Intentionally deferred decisions (not blocking Phases A–D)

- Signed MAVLink v2 verification/support; first-slice Go behavior remains reject.
- Bounded live snapshot retention, queue/connection byte limits, global GCS
  identity configuration, live clock policy, and WebSocket dependency selection.
- Provenanced live parameter-list capture; Phase D evidence remains partial.
