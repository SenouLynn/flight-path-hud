# Go bridge first-slice capability matrix

Statuses are `complete`, `partial`, or `unstarted`. Case IDs are stable and map
only externally observable behavior or important negative paths; ordinary unit
tests do not add rows. Evidence provenance is recorded beside each artifact.

| Case ID | Behavior | Evidence artifact and provenance | Node status/test | Go status/test | Difference |
| --- | --- | --- | --- | --- | --- |
| NORM-HEARTBEAT | HEARTBEAT normalization | raw capture + dialect-derived nonzero vector | complete: normalization conformance | complete: `TestDialectDerivedNormalizedPayloads` | none |
| NORM-PARAM-VALUE | PARAM_VALUE normalization | dialect-derived nonzero vector; no raw read capture | complete | complete | raw provenance remains weaker than recorded families |
| NORM-ATTITUDE | ATTITUDE normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-GPS-RAW-INT | GPS_RAW_INT normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-GLOBAL-POSITION-INT | GLOBAL_POSITION_INT normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-VFR-HUD | VFR_HUD normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-COMMAND-ACK | COMMAND_ACK normalization | dialect-derived nonzero vector | complete | complete | no raw recording |
| NORM-MISSION-COUNT | MISSION_COUNT normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-MISSION-ITEM-INT | MISSION_ITEM_INT normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-MISSION-REQUEST-INT | MISSION_REQUEST_INT normalization | dialect-derived nonzero vector | complete | complete | no raw recording |
| NORM-MISSION-REQUEST | MISSION_REQUEST normalization | dialect-derived nonzero vector | complete | complete | no raw recording |
| NORM-MISSION-CURRENT | MISSION_CURRENT normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-MISSION-ACK | MISSION_ACK normalization | dialect-derived nonzero vector | complete | complete | no raw recording |
| NORM-HOME-POSITION | HOME_POSITION normalization | raw capture + dialect-derived vector | complete | complete | none |
| NORM-GPS-GLOBAL-ORIGIN | GPS_GLOBAL_ORIGIN normalization | dialect-derived nonzero vector | complete | complete | no raw recording |
| FRAME-V1 | exact-minimum MAVLink v1 with CRC | common-dialect metadata/boundary fixture | complete | complete: `TestDialectBoundariesAllFamilies` | none |
| FRAME-V2 | unsigned v2, CRC, legal zero truncation | common-dialect metadata + raw captures | complete | complete | none |
| FRAME-SIGNED-V2 | signed v2 rejected once | dialect-derived malformed fixture | complete | complete | support intentionally deferred |
| FRAME-BAD-CRC | bad CRC rejected once | dialect-derived malformed fixture | complete | complete | none |
| FRAME-TRUNCATED | incomplete/invalid lengths reject once, no panic | all-family boundary fixture | complete | complete | none |
| FRAME-UNSUPPORTED | complete unsupported ID ignored | language-neutral malformed fixture | complete | complete | CRC unavailable by definition |
| FRAME-JSON | strict 15-family JSON ingress | normalized valid/invalid fixtures | complete | complete: `TestStrictJSONIngressFixtures` | authorized hardening from arbitrary passthrough |
| FRAME-NONFINITE | CRC-valid binary values must satisfy the JSON-number contract | strict normalized/core schemas + focused NaN tests | complete | complete | one decode/drop; no `null` publication |
| CORE-HEALTH | health on every core envelope and coupled counters | core schema + fixed-clock equality | complete | complete | none |
| CORE-SEQUENCE | zero fallback/wrap per core instance | fixed-clock schedule + core tests | complete | complete | corrected from handoff's process-global wording |
| CORE-ROSTER | sorted roster and strict TTL boundary | fixed-clock schedule + core tests | complete | complete | none |
| CORE-RATES | rate sorting by rate then name | fixed schedule + core tests | complete | complete | none |
| CORE-CONFLICTS | duplicate exact-system source conflict | Node/Go core tests | complete | complete | none |
| ROUTE-EXACT | exact `sysId:compId` route lookup | language-neutral route cases | complete: `systemRoutes.test.js` | complete: `routes_test.go` | none |
| ROUTE-EXPIRY | explicit-time route expiration | language-neutral route cases | complete: `systemRoutes.test.js` | complete: `routes_test.go` | none |
| REC-RAW | `base64` JSONL entry dispatches raw bytes | repository recording fixtures | complete: `mixedSitlFixture.test.js` | complete: `reader_test.go` | none |
| REC-EVENT | `event` JSONL entry dispatches lifecycle | parameter-write recording fixture | complete: parameter fixture tests | complete: `reader_test.go` | none |
| REPLAY-FIXED-CLOCK | unpaced raw replay uses every `atMs` explicitly | mixed MAVLink recording + fixed schedule | complete | complete: recording-core integration + Node/Go command equality | none |
| REPLAY-NO-SEND | replay API has no outbound-send method | compile/API and behavior tests | complete: replay/router tests | complete: `reader_test.go` reflection/API test | none |
| REPLAY-NO-TIMERS | offline replay creates no goroutines/timers | implementation inspection plus deterministic test | n/a | complete: synchronous `Replay.Dispatch` | Go-only structural gate |
| PARAM-VEC-NAME | PARAM_REQUEST_READ by name payload | `contracts/mavlink/parameter-command-vectors.json`, common dialect | complete: `parameterConformance.test.js` | complete: `parameter_test.go` | none |
| PARAM-VEC-INDEX | PARAM_REQUEST_READ by index payload | same | complete: same test | complete: same test | none |
| PARAM-VEC-LIST | PARAM_REQUEST_LIST payload | same | complete: same test | complete: same test | none |
| PARAM-READ-NAME | name correlation | Node tests + semantic trace | complete: `parameterRouter.test.js` | complete: `transactions_test.go` | none |
| PARAM-READ-INDEX | index correlation | Node tests + semantic trace | complete: `parameterRouter.test.js` | complete: `transactions_test.go` | none |
| PARAM-LIST-START | list start lifecycle | `contracts/semantics/parameter-list-trace.json`, independently reviewed policy trace | complete: `parameterConformance.test.js` | complete: `transactions_test.go` | none |
| PARAM-LIST-OUT-OF-ORDER | out-of-order values | same | complete: same test | complete: same test | none |
| PARAM-LIST-DUPLICATE | duplicate index replacement/no count advance | same | complete: same test | complete: same test | none |
| PARAM-LIST-PEER | peer-target value ignored | same | complete: same test | complete: same test | none |
| PARAM-LIST-COMPLETE | deterministic index-order completion | same | complete: same test | complete: same test | none |
| PARAM-LIST-IDLE | idle retry then failure | same | complete: same test | complete: same test | none |
| PARAM-ROUTE-LOSS | pending transaction fails on route loss | same | complete: same test | complete: same test | Node's generic list-timeout reason retained |
| PARAM-REPLAY | replay request rejected without bytes | same | complete: same test | complete: same test | none |
| PARAM-INVALID-TARGET | broadcast/invalid target rejected | same | complete: same test | complete: same test | none |
| PARAM-RECORDED-READ | passive recorded parameterRead folding | sanitized mixed-SITL parameter-write recording | complete: fixture tests | complete: `transactions_test.go` folds 20 events | none |
| PARAM-LIST-LIVE-EVIDENCE | live parameterList producer sequence | unavailable until live adapter/SITL capture | unstarted | partial: semantic trace only | intentionally deferred |

## Phase gate audits

- Phase A: contracts and fixtures inspected; no unresolved authority conflict found.
  Signed-v2 support, snapshot retention, and live resource limits are intentionally
  deferred by the handoff, not open questions in this phase.
- Phase B: audited strict ingress/core/public schemas, the exact eight-family raw
  publish policy, all 15 Node/Go decoders, health, and framing vectors. OQ-001,
  OQ-002, and OQ-003 are resolved; no additional open question found.
- Phase C: audited Node `systemRoutes`, recording reader, replay adapter/tests,
  both repository fixtures, and the fixed-clock harness. Exact routes, JSONL
  ownership/dispatch, finite transmit-free replay, raw core re-entry, and
  fixed-clock Node/Go equality are complete. No additional open question found.
- Phase D: audited both Node parameter routers/codecs/tests, lifecycle schema and
  valid fixtures, and all 32 sanitized parameter-write recording events. Request
  vectors, pure read/list folds, exact-target behavior, retries, passive recorded
  reads, transmit-free replay rejection, and the raw PARAM_VALUE-to-transaction
  seam are complete. The live list-evidence row remains intentionally partial.
  No additional open question found.

The Go folds intentionally retain only active transactions. Completed request IDs
and late-client snapshots remain caller policy; this is the handoff's required
bounded-snapshot deferral rather than an unexplained Node parity difference.
