# Portable contract pack

This directory is the language-neutral source of truth for selected wire shapes,
domain behavior, and MAVLink bytes. It is evidence for a future implementation,
not a commitment to its language or UI/runtime stack.

## Compatibility policy

The live WebSocket shape remains **protocol version 0**. This extraction does
not add an envelope or change production behavior. A future version 1 envelope
requires a separate migration decision.

Schemas use JSON Schema Draft 2020-12 and describe what a producer should emit.
They are intentionally strict (`additionalProperties: false`). Current consumers
remain tolerant: they rebuild known fields, discard unknown ones, sanitize
non-finite telemetry members, and reject malformed identity or required fields.
The fixtures under `fixtures/consumer` preserve that distinct behavior. Additive
producer changes therefore require schema updates, while old consumers may
continue safely ignoring new fields.

JSON itself cannot encode `NaN` or infinity. Their consumer sanitization remains
covered by implementation tests rather than misleading JSON fixtures.

## Layout

- `wire/`: strict producer schemas for the initial untagged telemetry family and
  selected tagged state/lifecycle families.
- `fixtures/`: valid/invalid producer examples and tolerant-consumer cases.
- `semantics/`: field metadata and shared known-answer vectors.
- `mavlink/`: exact deterministic payload bytes plus decoded expectations.
- `conformance/`: small independent proof consumers; never product runtime code.

The MAVLink dialect remains authoritative for standard layouts. Golden vectors
define the supported project policy and catch ordering, scaling, endianness, and
width errors. Full frames contain a mutable sequence, so the initial vectors
compare the exact 35-byte `COMMAND_INT` payload and separately verify normal
frame CRC tests. Guided takeoff/land, mode-change, and standard arm/disarm
vectors likewise compare exact 33-byte `COMMAND_LONG` payloads while their
implementation-local tests verify CRCs. The arm/disarm vectors explicitly
require the force parameter to be zero.

## Demonstrating conformance

From the repository root:

```sh
pnpm test:gcs-core
pnpm test:hud-ui
pnpm test:bridge
python3 contracts/conformance/heading_vectors.py
```

A future implementation demonstrates conformance by consuming these checked-in
files directly. Expected values must not be copied into source code.

## Coverage and roadmap

The initial vertical slice is complete:

- strict producer schemas cover legacy telemetry plus selected tagged flight and
  command-lifecycle frames;
- tolerant consumer behavior is recorded separately where it intentionally
  differs from the producer contract;
- heading known-answer cases are consumed by TypeScript and a small independent
  Python runner; and
- Guided reposition, takeoff, and landing encoders are checked against exact
  MAVLink payload bytes while implementation-local tests verify complete-frame
  CRCs;
- mode-change and arm/disarm lifecycle frames have strict producer schemas and
  exact command payload vectors; and
- ordered mode-change and arm/disarm traces define ACK, observation, timeout,
  stale-route, and passive-replay behavior; and
- strict schemas now cover every current protocol-v0 server family and all
  thirteen client-command families, including the bridge-only parameter,
  message-request, message-interval, mission-upload, and generic-command
  lifecycles.

Expand by operational risk rather than mechanically translating every test:

1. Extend the strict schemas whenever a new server frame or client command is
   introduced; no current protocol-v0 family is intentionally omitted.
2. Move more pure HUD calculations into shared vectors, prioritizing sign,
   coordinate-frame, unit, and fallback behavior.
3. Add golden bytes for the remaining safety-sensitive command encoders.
4. Expand ordered event traces beyond mode-change and arm/disarm where another
   implementation needs to reproduce command/router and replay behavior.
5. Name lifecycle/capability ports when a second implementation needs them;
   express those ports idiomatically rather than generating runtime architecture
   from JSON Schema.
6. Decide and document a protocol-v1 envelope and compatibility policy before
   changing the live WebSocket shape.

### Portable Guided workflow

The reusable eligibility policy for Guided entry, arming, takeoff, landing, and
final disarm now lives in the pure `gcs-core` workflow resolver. React retains
only form state, confirmation consumption, and command dispatch. The resolver
consumes a language-neutral ordered trace covering valid progress, exact-target
and operator confirmation binding, replay/staleness, supported identity, pending
or failed commands, input bounds, state escape, touchdown verification, and
final disarm eligibility. React button state is not part of the contract.

Rendering, socket/process lifecycle, filesystem behavior, and framework wiring
remain implementation-specific unless a pure domain seam is extracted.
