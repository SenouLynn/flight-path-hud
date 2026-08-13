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
frame CRC tests. Guided takeoff/land vectors likewise compare exact 33-byte
`COMMAND_LONG` payloads while their implementation-local tests verify CRCs.

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
  CRCs.

Expand by operational risk rather than mechanically translating every test:

1. Add schemas for the remaining bridge frame and client-command families.
2. Move more pure HUD calculations into shared vectors, prioritizing sign,
   coordinate-frame, unit, and fallback behavior.
3. Add golden bytes for the remaining safety-sensitive command encoders.
4. Add ordered event traces for command/router state machines and replay
   snapshots where another implementation needs to reproduce their behavior.
5. Name lifecycle/capability ports when a second implementation needs them;
   express those ports idiomatically rather than generating runtime architecture
   from JSON Schema.
6. Decide and document a protocol-v1 envelope and compatibility policy before
   changing the live WebSocket shape.

### TODO: portable Guided workflow

The browser currently sequences Guided entry, arming, takeoff, reposition,
landing, and disarming through UI orchestration over independently verified
command families. If that sequence becomes reusable application behavior,
extract it into a pure workflow state machine first. Then add a language-neutral
ordered trace covering valid progress, explicit target binding, operator
confirmation consumption, failed preconditions, timeouts, state escape, replay,
touchdown verification, and final disarm eligibility. Do not encode React button
state itself as the portable contract.

Rendering, socket/process lifecycle, filesystem behavior, and framework wiring
remain implementation-specific unless a pure domain seam is extracted.
