# Portable contracts inventory

This Phase 0 inventory records the current boundary before contract extraction.
Production behavior is unchanged.

## JSON boundary

`packages/gcs-core/src/wire.ts` consumes untagged telemetry plus tagged mission,
home, link-mode, flight-state, and guided-command lifecycle frames. Client
commands originate in the GCS and are routed by the JavaScript bridge. This
initial slice covers telemetry and flight-state server frames because together
they prove both legacy untagged and newer tagged shapes.

Telemetry requires finite envelope timestamps, uint8 identity and sequence,
a non-blank message name, and a finite payload timestamp. Its parser rebuilds
known fields, drops unknown sections/keys, and drops non-finite inner numerics.
Tagged parsers reject malformed known fields and return `unrecognized`; they do
not throw. Unknown keys are generally ignored.

The first follow-on slice adds strict producer contracts for the Copter Guided
takeoff and landing lifecycle frames introduced by the verified isolated-SITL
workflow. Their exact `COMMAND_LONG` payloads join Guided reposition in the
golden-vector layer; UI sequencing and live safety gates remain
implementation-local, backed by router tests and SITL evidence.

The strict producer schema and tolerant consumer are separate contracts. Trying
to make one schema express both would either bless bridge output containing
unknown fields or falsely claim the current consumer rejects additive fields.

## Portable and implementation-local tests

Pure resolver cases under `packages/hud-ui/src/logic` are portable; heading is
the first shared vector. MAVLink protocol encoders are portable at the byte
boundary; guided reposition is the first golden payload. Router transitions,
replay snapshots, and other command encoders are next by operational risk.

React rendering, WebSocket/UDP lifecycle, filesystem recording, and process
behavior remain implementation-specific. Named port documentation is deferred
until a second implementation needs the lifecycle boundary.

## Decisions

- JSON Schema Draft 2020-12, validated in tests with Ajv 8.
- Protocol version 0 is documented but the live wire shape is not changed.
- Strict producer schemas; tolerant behavior is captured in consumer fixtures.
- Unknown producer fields require schema evolution. Existing consumers may
  ignore additive fields; enum expansion is not assumed safe.
- Numeric timestamps remain JSON numbers in v0 and are documented as float64
  milliseconds. A v1 precision/ordering policy remains an explicit future ADR.
- Phase 2 uses a tiny Python standard-library proof consumer solely to show that
  another language can read the artifact; it makes no runtime choice.
