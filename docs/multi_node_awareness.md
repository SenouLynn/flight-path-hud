# Multi-node awareness (future phase)

**Status: target, not scheduled.** Gated on the single-node system being robust,
tested, and validated in real life — see
[ADR-0026](./decisions.md) for why that gate exists and what it means.

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
- **The UI has a system selector**, populated from the live roster.

The gap is presentation, not data: the map renders the selected system only, and
the sidebar describes one vehicle. The state for the others already exists and is
already bounded.

## What would actually change

1. **Identity.** `sysId:compId` is a MAVLink concept. TAK uses UIDs, callsigns and
   types; Meshtastic uses node IDs. A broader `NodeIdentity` is needed, with the
   MAVLink system becoming one kind of identity rather than the only one.
2. **A node model above `VehicleState`.** Position, course, staleness, identity,
   and a type/affiliation. `VehicleState` becomes one contributor to it, not the
   root.
3. **Ingress adapters per transport.** The port model already anticipates this —
   Meshtastic and CoT ingress sit beside UDP and replay, and the bridge core does
   not change.
4. **Presentation for many.** Simultaneous markers, labels, filtering, affiliation
   colour, and a selection model that is "focus one of many" rather than "show
   one".
5. **Staleness as a first-class display concept.** A mesh node heard from four
   minutes ago is not the same as a vehicle streaming at 33 Hz, and the map has to
   say which is which.

## What must be true first

The gate, stated plainly: **single-node has to be robust, tested and flown before
this starts.** Specifically —

- Real hardware or SITL in place of the synthetic sender, with the decoders
  validated against actual MAVLink rather than our own generator.
- The known gaps closed or consciously accepted (bundle size on a Pi, replay
  memory ceiling, the untested v2 payload-truncation path).
- Field validation: the thing used in anger once, not just watched on a desk.

Building multi-node on an unvalidated single-node core would multiply every
unproven assumption by the number of nodes.

## The pattern to follow

The development pattern this repo has settled into, and which should carry
forward unchanged:

1. **Build the logic in isolation and keep it portable** — pure, framework-free,
   no DOM, no transport. `gcs-core` and `hud-ui/logic` are the examples.
2. **Test it hard, in isolation.** The suite is what makes the next change safe.
3. **Integrate against a mock that is itself portable** — `sampleSender.js` and
   `mockCamera.js` are stand-ins that speak the real protocol, so replacing them
   with real hardware is a producer swap and nothing above changes.
4. **Then embellish.** Presentation last, on top of something already proven.

Multi-node should be approached the same way: a node model and its folds, tested
alone; a mock mesh producer; then the map that draws them.
