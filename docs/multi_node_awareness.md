# Multi-node awareness

**Status: producer and domain layers underway; presentation still gated.**
[ADR-0026](./decisions.md) gated this phase on the single-node system being
validated in real life. [ADR-0028](./decisions.md) amends that gate's scope:
work may proceed *while every node on the link is synthetic*, because a second
mock is itself a validation instrument. Real hardware or SITL is still the
precondition for any multi-node UI and for calling multi-node validated.

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

The gap is presentation, not data: the map renders the selected system only, and
the sidebar describes one vehicle. The state for the others already exists, is
already bounded, and is now already summarised.

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
4. **Presentation for many.** Still gated. Simultaneous markers, labels,
   filtering, affiliation colour, and a selection model that is "focus one of
   many" rather than "show one".
5. ~~**Staleness as a first-class display concept.**~~ **Modelled, not yet
   drawn.** `classifyFreshness` bands age into `live`/`aging`/`stale`, separately
   from eviction TTL and with per-transport thresholds. Nothing renders it yet.

## What must be true first

**For presentation, and for calling multi-node validated** — single-node has to be
robust, tested and flown. Specifically:

- Real hardware or SITL in place of the synthetic fleet, with the decoders
  validated against actual MAVLink rather than our own generator.
- The known gaps closed or consciously accepted (bundle size on a Pi, replay
  memory ceiling, the untested v2 payload-truncation path).
- Field validation: the thing used in anger once, not just watched on a desk.

Building multi-node *presentation* on an unvalidated single-node core would
multiply every unproven assumption by the number of nodes.

**For producer and domain work** the bar is lower, and deliberately so — see
[ADR-0028](./decisions.md). A second synthetic node is a way of testing the core,
not a claim about it: writing one immediately exposed a latent single-node defect
(`decodeMissionRequest` discarded `target_system`, so a second vehicle would have
answered its neighbour's mission requests). That is the argument for doing this
part early rather than late.

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

Multi-node is being approached the same way: the node model and its folds, tested
alone; a mock fleet that speaks the real protocol; then the map that draws them.
Steps 1-3 are in place for MAVLink nodes. Still ahead: a mock mesh producer on a
second transport, and the presentation layer.

## The UI shape this is heading for

Recorded so the seams land in the right place. **Two separate views, each with its
own map:**

- **Node view** — the current UI, and it *is* the single-node view. Instruments,
  logs, mission and sidebar all follow exactly one node. `MapPanel.tsx` stays
  single-node; it does not grow a multi-node display mode.
- **Fleet view** — new and independent: a roster plus its own unified map showing
  every node. It consumes `NodeSummary[]` directly, which is what that projection
  exists for.

They stay decoupled for now; the link between them (fleet → focus a node → node
view) is deliberately left open. Because the two maps are separate components
rather than one mode-switching component, the shared parts of `MapPanel.tsx` —
`toLngLat`, `buildStyle`, the marker-element factories, `addOverlayLayers` — are
the extraction candidates when the fleet map is built, and the keyed-diff pattern
already used there for waypoint markers is the model for drawing N vehicles.
