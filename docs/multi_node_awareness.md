# Multi-node awareness

**Status: producer, domain and presentation built for MAVLink nodes, with a
mixed ArduCopter/ArduPlane SITL harness Docker-built and manually observed live.
The two-node roster, independent missions, map placement and per-system routing
have been exercised. The repeatable capture/replay and stop/restart portions of
the acceptance checklist remain before calling this scenario fully validated.
Not field-validated.**
[ADR-0026](./decisions.md) gated this phase on the single-node system being
validated in real life. [ADR-0028](./decisions.md) amended that gate's scope to
let producer work proceed *while every node on the link is synthetic*, because a
second mock is itself a validation instrument; [ADR-0029](./decisions.md)
extended the same reasoning to presentation, and redrew the line around *claims*
rather than code. Real hardware or SITL is still the precondition for calling
multi-node validated and for any operational use.

Everything built so far is deliberately load-bearing for this. Nothing here asks
for a rewrite; it asks for a broader identity model and a presentation layer that
shows more than one thing at a time.

## The target

TAK-style shared situational awareness: many nodes on one picture, each with a
position, an identity and a staleness, contributed by different transports.

- **Meshtastic** nodes — LoRa mesh, position beacons, low bandwidth, intermittent.
- **Other TAK-style participants** — anything speaking Cursor-on-Target (CoT) or
  reachable via a TAK server.
- **MAVLink vehicles** — what exists today.

The unifying idea is that a vehicle we fly and a node someone is carrying are the
same kind of object on the map, differing in transport and in what they report.

## Next load-bearing validation step

Complete and preserve the mixed ArduCopter (`1:1`) + ArduPlane (`2:1`) Docker
SITL acceptance scenario: stop/restart one simulator, replay the captured
session, then curate a short sanitized recording as the versioned real-producer
fixture. This is the evidence gate for MAVLink v2 decoding, per-system UDP
mission return routing, independent mission pulls, stale-node eviction,
reconnect, recording, and replay. The checked-in fixture remains a
binary-contract fixture until that captured SITL fixture is added.

## What is already multi-node

More than might be obvious, because the folds were written per system from the
start:

- **The bridge** keeps a roster of every `sysId:compId` it has heard, with TTL
  eviction, and publishes it in stream health.
- **It detects duplicate transmitters** — one system arriving from two source
  endpoints — which only means anything because systems are distinguished.
- **`gcs-core` folds per system**: `vehicles`, `tracks`, `origins`, `positions`
  and `enuTracks` are all keyed by system, and each is TTL-swept.
- **The mission router** holds a `missionSync` per system and caches the last
  known plan and home position per system.
- **The UI has a system selector**, populated from the live roster.
- **The mock produces a fleet.** `mockFleetRunner.js` hosts N vehicles on one
  socket from the `mockNodes.js` roster — today a snake node (sysId 1) and an
  analytic figure eight (sysId 2), each with its own origin, profile and mission.
  `MAVLINK_BRIDGE_MOCK_NODES=snake-01` narrows it to a single stream.
- **`gcs-core/nodes.ts` supplies the node model** — `NodeIdentity`,
  `NodeSummary` and freshness banding, derived from the per-system folds rather
  than accumulated separately. `useVehicleFeed` publishes it as `nodes`.

- **The fleet view consumes it.** A roster plus its own unified map, drawing
  every node, its route and its waypoints in a per-node colour, above the
  single-node view as list-to-detail. `useVehicleFeed` publishes `missions` per
  system alongside `nodes`, so a plan belonging to a node nobody has selected is
  no longer invisible.

The gap is no longer data or presentation but *repeatable evidence*: the live
SITL smoke run has exercised the data path, while the preserved recording and
the stop/restart/replay acceptance evidence remain to be completed.

## What would actually change

1. ~~**Identity.**~~ **Done.** `NodeIdentity` in `gcs-core/nodes.ts` — an id, a
   `NodeKind` and a label, with `mavlink-vehicle` as the first kind. TAK UIDs and
   Meshtastic node IDs join as further kinds, not as fake `sysId:compId` pairs.
2. ~~**A node model above `VehicleState`.**~~ **Partly done.** `NodeSummary`
   carries position, course, identity and staleness, with `VehicleState` demoted
   to a contributor. Type/affiliation is still open, and belongs with the first
   non-MAVLink transport that needs it.
3. **Ingress adapters per transport.** Unchanged and still ahead. The port model
   already anticipates it — Meshtastic and CoT ingress sit beside UDP and replay,
   and the bridge core does not move.
4. ~~**Presentation for many.**~~ **Mostly done.** Simultaneous markers, per-node
   colour, and a selection model that is "focus one of many" rather than "show
   one" — the fleet roster pins `selectedSystem` and hands off to the node view.
   Labels are DOM markers, not `text-field` symbols, for the reason in
   [ADR-0024](./decisions.md). Still open: filtering, and affiliation colour,
   which needs a type/affiliation model this has no transport to justify yet.
5. ~~**Staleness as a first-class display concept.**~~ **Done.**
   `classifyFreshness` bands age into `live`/`aging`/`stale`, separately from
   eviction TTL and with per-transport thresholds. Rendered as marker opacity on
   the fleet map and as a band plus an age on each roster row.

## What must be true first

**For calling multi-node validated** — single-node has to be robust, tested and
flown. Specifically:

- Real hardware or SITL in place of the synthetic fleet, with the decoders
  validated against actual MAVLink rather than our own generator.
- The known gaps closed or consciously accepted (bundle size on a Pi, replay
  memory ceiling, the untested v2 payload-truncation path).
- Field validation: the thing used in anger once, not just watched on a desk.

**For building** the bar is lower, and deliberately so — see
[ADR-0028](./decisions.md) and [ADR-0029](./decisions.md). A synthetic fleet is a
way of testing the core, not a claim about it, and each layer built against it
immediately exposed a latent defect the single-node system could not reach:
`decodeMissionRequest` discarded `target_system`, so a second vehicle would have
answered its neighbour's mission requests; and the node id (`mavlink:1:1`) had no
converter to the system key (`1:1`) that every fold, `knownSystems` and
`selectedSystem` use, while `NodeIdentity.label` coincidentally equalled it —
making the wrong implementation work right up until a node gets a real callsign.
That is the argument for doing these parts early rather than late.

What is *not* lowered: none of this says the fleet picture is right. It says the
wiring behind it is exercised.

## The pattern to follow

The development pattern this repo has settled into, and which should carry
forward unchanged:

1. **Build the logic in isolation and keep it portable** — pure, framework-free,
   no DOM, no transport. `gcs-core` and `hud-ui/logic` are the examples.
2. **Test it hard, in isolation.** The suite is what makes the next change safe.
3. **Integrate against a mock that is itself portable** — `mockFleetRunner.js` and
   `mockCamera.js` are stand-ins that speak the real protocol, so replacing them
   with real hardware is a producer swap and nothing above changes.
4. **Then embellish.** Presentation last, on top of something already proven.

Multi-node followed it exactly: the node model and its folds, tested alone; a
mock fleet that speaks the real protocol; then the map that draws them. All four
steps are in place for MAVLink nodes. Still ahead: a mock mesh producer on a
second transport.

## The UI shape

**Two separate views, each with its own map**, as built:

- **Node view** (`NodeView.tsx`) — the original UI, and it *is* the single-node
  view. Instruments, logs, mission and sidebar all follow exactly one node.
  `MapPanel.tsx` stayed single-node; it did not grow a multi-node display mode.
- **Fleet view** (`fleet/FleetView.tsx`) — independent: a roster plus its own
  unified map showing every node. It consumes `NodeSummary[]` directly, which is
  what that projection exists for.

`App.tsx` is the shell above both, and owns `useVehicleFeed` — its cleanup stops
the socket and resets every fold, so a feed owned by either view would drop the
link and every trail on each navigation. Only the inactive view unmounts, which
also keeps exactly one MapLibre context alive at a time.

The seam between them is one callback: the roster maps a node id back to a system
key and pins `selectedSystem`, which is what makes it "focus this node" rather
than "show whichever reported last".

The shared parts of `MapPanel.tsx` moved to `map/mapAdapter.ts` — `toLngLat`,
`buildStyle`, the marker-element factories — and the keyed-diff pattern it used
for waypoint markers is what `FleetMap.tsx` uses for N vehicles, keyed on
`identity.id`. `addOverlayLayers` did *not* move: it hard-codes one track and one
route, where the fleet map needs a single data-driven layer whose `line-color`
reads a per-feature property.

They stay decoupled for now; the link between them (fleet → focus a node → node
view) is deliberately left open. Because the two maps are separate components
rather than one mode-switching component, the shared parts of `MapPanel.tsx` —
`toLngLat`, `buildStyle`, the marker-element factories, `addOverlayLayers` — are
the extraction candidates when the fleet map is built, and the keyed-diff pattern
already used there for waypoint markers is the model for drawing N vehicles.
