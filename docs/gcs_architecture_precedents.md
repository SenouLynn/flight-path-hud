# GCS architecture precedents: QGroundControl and Mission Planner

This note records what this project intends to learn from two mature ground
control stations. It is architectural guidance, not a feature-parity target and
not a claim that either upstream project uses the same contract-first approach.

## Summary

- **QGroundControl (QGC)** is the closest architectural precedent: transport
  links, MAVLink decoding, a multi-vehicle manager, rich per-vehicle domain
  objects, dedicated mission/command managers, metadata-backed values, QML UI,
  and mock links.
- **Mission Planner (MP)** is the strongest operational precedent: deep
  ArduPilot support, log/replay workflows, SITL and field compatibility,
  extensive diagnostics, and practical accommodation of unusual hardware.
- This project deliberately differs from both by making its **contracts and
  conformance evidence** portable independently of any one runtime or UI stack.

## Comparable data flows

QGroundControl is broadly organized as:

```text
serial / UDP / TCP
        ↓
   LinkInterface
        ↓
  MAVLinkProtocol
        ↓
MultiVehicleManager
        ↓
      Vehicle
   ↙     ↓      ↘
Facts  Missions  Commands
        ↓
       QML
```

Mission Planner is broadly organized as:

```text
serial / UDP / TCP / log
          ↓
   MAVLinkInterface
          ↓
 MAVState / CurrentState
          ↓
WinForms views, HUD, map,
planning and configuration
```

The intended direction here is:

```text
MAVLink transport adapters
          ↓
decoder + explicit safety policy
          ↓
per-vehicle domain runtimes
          ↓
versioned domain-event contract
          ↓
React, ImGui, Phoenix clients,
recorders, or embedded renderers
```

The last boundary already exists as the bridge WebSocket. It therefore deserves
an explicit, versioned contract even while all current consumers remain in
TypeScript.

## What to internalize from QGroundControl

### Vehicle identity is not transport identity

QGC separates link management from vehicle ownership. A vehicle can have link
state and a selected primary link without mission or presentation code treating
the current socket as the vehicle itself.

Preserve the same distinction here:

- `sysId:compId` identifies domain scope;
- an ingress/route describes how that scope is currently reachable;
- route loss changes capability and health, not vehicle identity;
- command and mission operations remain explicitly target-scoped; and
- multiple links may be supported later without changing domain APIs.

### Use a per-vehicle aggregate

QGC's `Vehicle` owns or coordinates missions, parameters, command acknowledgments,
message intervals, connection state, and firmware-specific behavior. This is a
useful destination for the bridge's repeated router fan-out.

A future internal shape may resemble:

```text
FleetRuntime
  ├── VehicleRuntime 1:1
  │     ├── FlightState
  │     ├── MissionSession
  │     ├── ParameterSession
  │     ├── CommandQueue
  │     └── Route/LinkState
  └── VehicleRuntime 2:1
        └── ...
```

This is guidance for incremental refactoring, not authorization for a wholesale
bridge rewrite. Introduce the aggregate only when it reduces real duplication
and preserve the existing explicit safety gates.

### Metadata belongs beside values and commands

QGC's Fact system associates values with type, units, range, precision, enum or
bitmask information, defaults, conversions, and control metadata. It also uses
JSON command information with firmware- and vehicle-class-specific overrides.

Adopt the underlying principle without copying Qt's API:

```text
common definition
      +
firmware override
      +
vehicle-class override
      +
local safety policy
```

The portable semantic registry in
[the contract pack](../contracts/README.md) should capture
units, scaling, coordinate frames, sign conventions, fallback priority, and
valid ranges. Metadata improves UI generation and validation, but it does not
replace state-machine or byte-level tests.

### Mock the real boundary

QGC's mock links exercise the normal application path. Continue the same pattern
with UDP/replay ingress, mock fleets, checked-in recordings, and SITL. Avoid
special mock-only domain paths that production data never traverses.

## What to internalize from Mission Planner

### Operational evidence matters

MP's strength is not architectural purity; it is accumulated compatibility with
real ArduPilot vehicles, logs, parameters, missions, and field workflows. Keep
our evidence ladder:

1. pure known-answer vectors;
2. byte and state-machine tests;
3. deterministic mock fleet;
4. curated real-producer recordings;
5. pinned mixed-vehicle SITL; and
6. later bench and field validation.

No schema or unit test substitutes for the higher layers.

### Autopilot differences are real domain behavior

Do not flatten Copter, Plane, PX4, and other firmware/vehicle combinations into
one generic model when their command semantics differ. Keep common transport and
domain contracts, then express explicit firmware and vehicle-class policies.

Guided reposition already demonstrates this rule: Copter and Plane accept
different controls and must not share implicit defaults merely because both use
`MAV_CMD_DO_REPOSITION`.

### Avoid global convenience becoming architecture

MP exposes a central communication object and a large current-state object to
many UI and plugin consumers. That is convenient and successful, but it makes
raw protocol state, normalized values, derived calculations, unit conversion,
and presentation concerns expensive to separate later.

This project therefore avoids:

- a global "active vehicle" as an authority or routing decision;
- UI components reaching directly into a transport singleton;
- one unbounded mutable `CurrentState` object;
- silent fallback to the most recent sender; and
- plugin APIs that expose internal transports when a domain capability suffices.

## The project's stronger portability requirement

QGC's practical portability unit is its Qt/C++ application. MP's is primarily its
.NET/C# application. This project intentionally defines a smaller unit:

> Protocol evidence and domain behavior must survive a change of language,
> renderer, operating system, and process topology.

The portable contract pack therefore contains complementary artifacts:

- JSON Schema for process-boundary data;
- semantic metadata for units, widths, frames, and fallback rules;
- input/output vectors for domain behavior;
- golden bytes for MAVLink encoders and decoders;
- ordered traces for state machines; and
- named lifecycle/capability ports implemented idiomatically in each language.

The artifact is the evidence, not Vitest, Catch2, ExUnit, Qt, React, or Phoenix.

## Design rules for future work

1. **Domain scope is explicit.** State and operations are keyed to a concrete
   vehicle; UI selection never silently supplies command authority.
2. **Links are adapters and capabilities.** Transport details do not leak into
   mission, command, HUD, or map logic.
3. **Per-vehicle behavior is cohesive.** Prefer a bounded vehicle aggregate over
   repeated global router fan-out, without creating a giant presentation model.
4. **Raw, normalized, derived, and rendered data remain distinguishable.** A
   convenient property must still have a documented owner and transformation.
5. **Metadata drives validation and presentation, not behavior by itself.** Use
   vectors, traces, and golden bytes for executable semantics.
6. **Firmware differences are explicit overrides.** Never bury them in UI
   conditionals or ambiguous defaults.
7. **Mocks enter through production seams.** Replay and simulation exercise the
   same domain path as live MAVLink.
8. **Operational evidence is cumulative.** Passing a lower validation layer does
   not waive SITL, bench, or field evidence where risk requires it.
9. **The wire boundary is versioned.** Additive evolution and compatibility are
   deliberate rather than consequences of JavaScript object permissiveness.
10. **Do not port architecture speculatively.** Extract a contract and prove one
    independent consumer before committing to a complete alternate runtime.

## Upstream references

- [QGC high-level class hierarchy](https://docs.qgroundcontrol.com/master/en/qgc-dev-guide/classes/index.html)
- [QGC Fact System](https://docs.qgroundcontrol.com/Stable_V5.0/en/qgc-dev-guide/fact_system.html)
- [QGC Vehicle implementation](https://github.com/mavlink/qgroundcontrol/blob/master/src/Vehicle/Vehicle.cc)
- [QGC VehicleLinkManager](https://api.qgroundcontrol.com/master/VehicleLinkManager_8h_source.html)
- [QGC ArduPilot firmware command overrides](https://github.com/mavlink/qgroundcontrol/blob/master/src/FirmwarePlugin/APM/APMFirmwarePlugin.cc)
- [QGC mock-link integration](https://github.com/mavlink/qgroundcontrol/blob/master/src/QmlControls/QGroundControlQmlGlobal.cc)
- [Mission Planner CurrentState](https://github.com/ArduPilot/MissionPlanner/blob/master/ExtLibs/ArduPilot/CurrentState.cs)
- [Mission Planner main application connection state](https://github.com/ArduPilot/MissionPlanner/blob/master/MainV2.cs)
- [Mission Planner plugin API](https://github.com/ArduPilot/MissionPlanner/blob/master/Plugin/Plugin.cs)

These links describe moving upstream projects. This repository's ADRs and tests,
not upstream implementation details, remain authoritative for local behavior.
