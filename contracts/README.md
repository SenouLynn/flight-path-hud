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

- `wire/`: strict producer schemas for one untagged and one tagged v0 family.
- `fixtures/`: valid/invalid producer examples and tolerant-consumer cases.
- `semantics/`: field metadata and shared known-answer vectors.
- `mavlink/`: exact deterministic payload bytes plus decoded expectations.
- `conformance/`: small independent proof consumers; never product runtime code.

The MAVLink dialect remains authoritative for standard layouts. Golden vectors
define the supported project policy and catch ordering, scaling, endianness, and
width errors. Full frames contain a mutable sequence, so the initial vectors
compare the exact 35-byte `COMMAND_INT` payload and separately verify normal
frame CRC tests.

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
