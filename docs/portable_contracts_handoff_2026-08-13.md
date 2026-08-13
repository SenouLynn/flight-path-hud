# Planning handoff — portable contracts and cross-language conformance

**Date:** 2026-08-13  
**Status:** Planning only; no contract extraction has been implemented.  
**Purpose:** Preserve enough context for a later contributor or autonomous agent
to make the current TypeScript/JavaScript harness a reliable backstop for a
future C++, Go, Rust, Elixir, or other implementation without prematurely
choosing the final hardware or UI stack.

Read this together with
[the QGroundControl/Mission Planner precedent analysis](gcs_architecture_precedents.md)
and [ADR-0032](decisions.md#adr-0032-borrow-mature-gcs-boundaries-make-contracts-and-evidence-the-portable-unit).

## Motivation

The project can continue moving quickly in the current React, TypeScript, and
JavaScript stack, where behavior is familiar and easy to validate. The eventual
runtime may instead be C++ with Dear ImGui, Elixir/Phoenix with React, or another
combination selected after the hardware target is clearer.

The current architectural boundaries are reasonably portable, but most tests
are not: their inputs, expected values, and assertions live directly in Vitest
or Node test files. Rewriting those tests in another language would create a
second interpretation of the behavior rather than a shared source of truth.

The goal is therefore **schema-first and conformance-first, not a TypeScript
conversion of the bridge**. TypeScript may still be useful internally, but it
should not be load-bearing for portability.

## Core decision

Create a language-neutral **contract pack** containing four complementary kinds
of evidence:

1. **JSON Schemas** make JSON data boundaries portable.
2. **Known-answer vectors** make domain behavior and calculations portable.
3. **Golden byte fixtures** make MAVLink encoding and decoding portable.
4. **Named port contracts** make lifecycle and dependency boundaries portable.

Schemas alone are insufficient. They can constrain an integer to `0..255`, but
they cannot fully specify endianness, float width, units, coordinate frames,
fallback priority, state-machine behavior, or numeric tolerance.

The intended result is that a future implementation can answer:

> Given these exact inputs, does this implementation produce an equivalent
> result?

The portable artifact is the input/output evidence, not the syntax of a Vitest,
Catch2, ExUnit, or other test runner.

## Existing seams to preserve

- [`packages/gcs-core/src/wire.ts`](../packages/gcs-core/src/wire.ts) currently
  defines and validates the bridge-to-GCS JSON contract. It includes telemetry,
  mission, home, link-mode, flight-state, and guided-reposition frames.
- [`packages/hud-ui/src/logic/telemetry.ts`](../packages/hud-ui/src/logic/telemetry.ts)
  defines the canonical telemetry sample and its finite-number sanitization.
- The pure logic under [`packages/hud-ui/src/logic/`](../packages/hud-ui/src/logic/)
  contains the best candidates for portable known-answer vectors.
- [`apps/mavlink-bridge/src/guidedRepositionProtocol.js`](../apps/mavlink-bridge/src/guidedRepositionProtocol.js)
  illustrates why types alone are insufficient: correctness depends on byte
  offsets, little-endian writes, fixed-width fields, scaling, and MAVLink CRC.
- `createUdpIngress` and `createReplayIngress` intentionally share a
  `start(onDatagram, onEvent?) => stop` shape. The bridge also relies on repeated
  send/route/record capabilities that should become named ports rather than
  remaining implicit duck types.
- Checked-in JSONL recordings and SITL fixtures already provide useful real-
  producer evidence. They should be reused and minimized rather than replaced.

## Proposed contract-pack layout

The exact filenames can change after inventory, but keep concerns separate:

```text
contracts/
  wire/
    envelope.schema.json
    telemetry-frame.schema.json
    mission-frame.schema.json
    home-frame.schema.json
    link-mode-frame.schema.json
    flight-state-frame.schema.json
    guided-reposition-frame.schema.json
    client-command.schema.json

  semantics/
    telemetry-fields.yaml
    heading-cases.json
    attitude-cases.json
    flight-path-cases.json
    trajectory-cases.json
    mission-state-cases.json
    guided-reposition-cases.json

  mavlink/
    guided-reposition-vectors.json
    mission-upload-vectors.json
    parameter-write-vectors.json
    mode-change-vectors.json

  fixtures/
    valid/
    invalid/
    recordings/

  README.md
```

Do not create every proposed file mechanically. Start with the smallest vertical
slice that proves another language can consume the artifacts.

## What each layer must express

### JSON wire schemas

Schemas should define required/optional fields, tagged variants, nullability,
enums, arrays, numeric ranges, coordinate limits, unknown-field policy, and an
explicit protocol version.

JSON has no fixed-width number types. Preserve both the accepted JSON domain and
the intended implementation type, for example:

```json
{
  "type": "integer",
  "minimum": 1,
  "maximum": 255,
  "x-wire-type": "uint8"
}
```

`x-wire-type` is descriptive metadata, not standard JSON Schema validation.
Keep runtime range checks even if generated TypeScript types still say `number`.

Do not assume generated types replace boundary behavior. The existing parsers
guard and rebuild objects, drop unknown sections, sanitize non-finite telemetry,
and return an unrecognized/null result rather than throwing. Those semantics
must remain explicit and tested.

### Semantic field registry

Record facts that JSON Schema cannot adequately describe:

- physical unit and scale;
- coordinate or reference frame;
- axis direction and sign conventions;
- valid sentinel values;
- timestamp source and precision;
- source/fallback priority;
- missing-field behavior; and
- numeric comparison tolerance.

For example, MAVLink NED `vz` is positive-down while the HUD's climb rate is
positive-up. A schema validating both as finite numbers would not catch an
inverted implementation.

### Known-answer behavioral vectors

Move meaningful inputs and expected outputs out of framework-specific tests.
Each case should include a stable name, input, expected output, and per-field or
documented default tolerance. It may also include expected source selection,
warnings, state transitions, or rejection reason where those are contractual.

The current Vitest/Node suites should load these vectors. A later C++ Catch2 or
Elixir ExUnit runner should load the same files rather than transcribing them.

Prefer explicit decimal tolerances. Do not rely on serialized `NaN` or
`Infinity`, which JSON cannot represent. Represent absent/invalid behavior using
the contract's documented null, omission, or rejection convention.

### MAVLink golden vectors

For safety-sensitive encoders and decoders, record:

- structured input;
- exact payload bytes or hex;
- exact full-frame bytes where deterministic;
- fields deliberately ignored during comparison, such as a caller-controlled
  sequence when appropriate;
- expected decoded fields; and
- expected rejection cases.

Exercise both directions where supported:

```text
structured input -> exact bytes
exact bytes -> expected decoded structure
```

This is what catches field order, endianness, float width, integer width,
coordinate scaling, sequence handling, framing, and CRC errors.

Do not redefine standard MAVLink message layouts as a private project schema.
MAVLink dialect XML remains authoritative for standard message definitions. The
project contract should specify the supported subset, project policy, safety
constraints, and golden results.

### Named port contracts

Document a small set of behavioral interfaces, likely including:

- `DatagramIngress`: start/stop, optional recorded events, routing capability;
- `Publisher`: publish a domain/wire event;
- `Recorder`: record datagrams/events and close;
- `Clock`: return current monotonic or wall-clock milliseconds as specified; and
- `CommandTransport`: determine routability and send bytes to an explicit target.

Express these idiomatically in each implementation: TypeScript interfaces,
C++ abstract interfaces/concepts, Go interfaces, Elixir behaviours, or Rust
traits. Do not try to generate lifecycle interfaces from JSON Schema.

## Protocol versioning decision needed

Telemetry frames are currently untagged while newer server frames use `type`.
Before presenting this boundary as stable across languages, choose and document
one of these approaches:

1. Preserve the current shape as protocol version 0 and introduce a uniform,
   explicit envelope in version 1; or
2. Add compatible version metadata without immediately reshaping every frame.

A future envelope could resemble:

```json
{
  "protocol": "flight-path-hud",
  "version": 1,
  "type": "telemetry",
  "payload": {}
}
```

The decision must also cover unknown types/fields, additive changes, enum
expansion, request IDs, ordering, integer bounds, timestamp precision, and
compatibility policy. Do not silently change the production WebSocket shape as
part of the first extraction slice.

## Test portability classification

| Current concern | Portable source of truth |
|---|---|
| Wire parsing and rejection | JSON Schema plus valid/invalid fixtures |
| HUD calculations and fallback logic | Language-neutral input/output vectors |
| MAVLink encoding/decoding | Golden byte vectors |
| Router/state-machine behavior | Ordered event traces with expected transitions/outputs |
| Replay determinism | Canonical JSONL recording plus expected final snapshots |
| React component rendering | Remains framework-specific |
| WebSocket/UDP lifecycle | Named contract plus implementation-specific tests |
| Filesystem/process behavior | Remains implementation-specific |

Do not force JSX, CSS, SVG, socket-library, or filesystem tests into the
portable layer. If rendering math is worth porting, first extract it into a pure
input/output model and give that model vectors; keep DOM and pixel presentation
tests local to React.

## Recommended implementation sequence

### Phase 0 — inventory and decisions

1. Inventory every inbound/outbound JSON shape in `wire.ts` and the bridge.
2. Inventory pure known-answer tests versus infrastructure/UI tests.
3. Record the current unknown-field, sanitization, and rejection behaviors.
4. Propose the versioning policy without changing the live wire format.
5. Select a JSON Schema draft and validator/generator toolchain already
   compatible with the repository's Node setup.

Deliverable: a short contract inventory and any necessary ADR, with no behavior
change.

### Phase 1 — smallest vertical slice

1. Extract one representative wire family, preferably telemetry plus one tagged
   frame, into schemas.
2. Add valid and invalid fixtures matching current parser behavior.
3. Validate bridge output in tests and validate the consumer fixtures.
4. Generate TypeScript data declarations if the chosen generator is stable, but
   retain explicit runtime parsing/sanitization.
5. Move one pure HUD resolver's cases, likely heading, into a JSON vector file
   consumed by the existing Vitest test.
6. Add guided-reposition golden payload/frame vectors consumed by the current
   Node test.

Deliverable: an end-to-end example of schema, behavior vector, and byte vector
without changing production behavior.

### Phase 2 — prove cross-language consumption

Create a deliberately small proof consumer, likely a native C++ command-line
test executable, that reads at least one behavioral vector or golden byte vector
and passes it independently. Keep this proof around 100–300 lines if possible;
it is evidence that the contract is usable, not the start of the full port.

Deliverable: the same checked-in artifact passes in the current implementation
and one independent language.

### Phase 3 — expand by risk

Prioritize command encoders, target routing, state machines, sign/scale
conversions, and replay determinism. Expand presentation-only cases later.
Avoid a large mechanical conversion of all tests before the vertical slice has
proven the representation and tooling.

## Acceptance criteria for the initial milestone

- There is one documented, versioned location for portable contracts.
- At least one existing JSON wire family is described by schema and exercised by
  valid and invalid fixtures.
- Existing runtime rejection/sanitization behavior has not accidentally changed.
- At least one pure HUD known-answer suite consumes external vectors.
- Guided reposition, or an equivalently safety-sensitive encoder, is checked
  against exact golden bytes.
- The normal repository tests and builds still pass.
- One small independent-language runner consumes an artifact without copying its
  expected values into source code.
- The contract README explains how a new implementation demonstrates
  conformance.
- No production wire migration, UI rewrite, or hardware commitment is bundled
  into the milestone.

## Non-goals

- Porting the complete bridge to TypeScript.
- Choosing C++/ImGui versus Elixir/Phoenix/React now.
- Replacing the MAVLink dialect definitions.
- Generating every runtime interface from an IDL.
- Making React rendering tests portable.
- Claiming schemas prove behavioral or byte-level compatibility.
- Rewriting the production WebSocket protocol during initial extraction.
- Porting the whole bridge as proof that the contract works.

## Architectural implications for later stack choices

Schema/conformance work keeps both likely directions open:

- **C++ + Dear ImGui** is a natural fit for native desktop/on-device rendering,
  direct byte handling, low latency, and a path closer to embedded targets. It
  carries more platform and rendering plumbing.
- **Elixir/Phoenix + React** is a strong fit for a supervisory multi-vehicle GCS,
  concurrent state machines, fault isolation, and telemetry fan-out. It remains
  a browser/service architecture rather than an embedded rendering solution.

The eventual system need not be one language. A stable versioned domain-event
contract can separate MAVLink/safety adapters, supervisory services, React or
ImGui clients, and embedded renderers.

## Instructions for an autonomous branch agent

Work on a dedicated branch/worktree and treat the initial milestone as contract
extraction, not redesign.

1. Read this document, `docs/architecture.md`, `docs/decisions.md`, and the files
   named under **Existing seams to preserve**.
2. Inspect the complete current test suite before selecting formats or tools.
3. Write an inventory/ADR first if a protocol or compatibility decision is
   required. Do not silently choose a new production envelope.
4. Implement Phase 1 as a narrow vertical slice. Preserve behavior and keep
   generated output reproducible.
5. Do not hand-edit generated files; document and test the generation command.
6. Do not add a runtime build step to the plain-JavaScript bridge unless the
   milestone clearly requires it. Test/dev-time validation is sufficient for the
   first slice.
7. Avoid large dependency additions. Justify the selected schema validator and
   generator by draft support, maintenance, deterministic output, and
   cross-language compatibility.
8. Run focused tests after each slice, then the relevant workspace tests and
   builds. Record commands and results in the PR/handoff.
9. Keep unrelated dirty-worktree changes intact. Commit coherent changes only
   on the dedicated branch.
10. Stop and request a decision if current parser behavior conflicts materially
    with strict schema validation, especially around unknown fields, partial
    telemetry sanitization, non-finite values, or backwards compatibility.

The branch is ready for review when the acceptance criteria above are met and
the diff is small enough to evaluate as evidence infrastructure rather than a
partial rewrite.

## Suggested first-agent prompt

> Implement Phase 0 and Phase 1 from
> `docs/portable_contracts_handoff_2026-08-13.md` on a dedicated branch. Begin by
> inventorying the actual wire shapes and current parser semantics. Build the
> smallest vertical slice that includes JSON Schema validation, externally stored
> known-answer cases for one pure HUD resolver, and a golden MAVLink byte vector.
> Preserve production behavior and the current WebSocket format. Do not port the
> bridge, choose a final UI/runtime stack, or broaden the scope without recording
> a decision. Run and report focused tests plus relevant workspace builds.

## Resume point

When this work is picked up, start with Phase 0. The most important early
question is not which generator to install; it is whether the current tolerant
consumer semantics should be represented as one strict schema, separate producer
and consumer schemas, or schema plus explicit sanitization tests. Resolve that
with concrete examples from `wire.ts` before creating a large schema tree.
