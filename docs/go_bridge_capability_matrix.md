# Go bridge first-slice capability matrix

Statuses are `complete`, `partial`, or `unstarted`. Case IDs are stable and map
only externally observable behavior or important negative paths; ordinary unit
tests do not add rows. Evidence provenance is recorded beside each artifact.

| Case ID | Behavior | Evidence artifact and provenance | Node status/test | Go status/test | Difference |
| --- | --- | --- | --- | --- | --- |
| NORM-HEARTBEAT | HEARTBEAT normalization | raw mixed-SITL recordings + Node decoder tests; common dialect | complete: `normalize.test.js` + raw capture | unstarted | OQ-001 blocks portable output shape |
| NORM-PARAM-VALUE | PARAM_VALUE normalization | Node decoder test; no raw read capture | complete: `normalize.test.js` | unstarted | independent normalization vector still required |
| NORM-ATTITUDE | ATTITUDE normalization | raw mixed-SITL recordings + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-GPS-RAW-INT | GPS_RAW_INT normalization | raw motion recording + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-GLOBAL-POSITION-INT | GLOBAL_POSITION_INT normalization | raw mixed-SITL recordings + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-VFR-HUD | VFR_HUD normalization | raw mixed-SITL recordings + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-COMMAND-ACK | COMMAND_ACK normalization | Node decoder test; no raw read capture | complete | unstarted | independent normalization vector still required |
| NORM-MISSION-COUNT | MISSION_COUNT normalization | raw mixed-SITL recordings + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-MISSION-ITEM-INT | MISSION_ITEM_INT normalization | raw mixed-SITL recordings + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-MISSION-REQUEST-INT | MISSION_REQUEST_INT normalization | Node decoder test; no raw read capture | complete | unstarted | independent normalization vector still required |
| NORM-MISSION-REQUEST | MISSION_REQUEST normalization | Node decoder test; no raw read capture | complete | unstarted | independent normalization vector still required |
| NORM-MISSION-CURRENT | MISSION_CURRENT normalization | raw motion recording + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-MISSION-ACK | MISSION_ACK normalization | Node decoder test; no raw read capture | complete | unstarted | independent normalization vector still required |
| NORM-HOME-POSITION | HOME_POSITION normalization | raw motion recording + Node decoder tests | complete | unstarted | OQ-001 blocks portable output shape |
| NORM-GPS-GLOBAL-ORIGIN | GPS_GLOBAL_ORIGIN normalization | Node decoder test; no raw read capture | complete | unstarted | independent normalization vector still required |
| FRAME-V1 | MAVLink v1 accepted with CRC | Node-generated frames plus published X.25 check vector | complete: `normalize.test.js` | unstarted | independent frame vector still required |
| FRAME-V2 | unsigned MAVLink v2 accepted with CRC/trailing-zero behavior | provenanced raw mixed-SITL recordings + Node tests | complete | unstarted | none expected after OQ resolution |
| FRAME-SIGNED-V2 | signed v2 rejected | constructed negative vector; Node behavior is not accepted authority | partial: apparent CRC-location defect documented | unstarted | Go deliberately rejects until signature policy exists |
| FRAME-BAD-CRC | bad CRC rejected and resynchronized | constructed corruption in `normalize.test.js` | complete | unstarted | OQ-002 blocks complete negative taxonomy |
| FRAME-TRUNCATED | truncated frame rejected without panic | Node truncation/padding tests | partial | unstarted | OQ-002: whole-frame and short-payload accounting differ |
| FRAME-UNSUPPORTED | valid unsupported message ignored | Node combined-frame test | complete | unstarted | OQ-002: CRC/accounting policy unresolved |
| FRAME-JSON | protocol-v0 JSON envelope input | fixed-clock schedule + Node normalization test | complete | unstarted | OQ-001 blocks schema relationship |
| CORE-HEALTH | health on every envelope and counters | fixed-clock schedule + recording equality test | complete | unstarted | OQ-001/OQ-002 |
| CORE-SEQUENCE | zero fallback and uint8 wrap | fixed-clock schedule + Node harness test | complete | unstarted | protocol-v0 debt retained |
| CORE-ROSTER | sorted roster and strict TTL boundary | Node `bridgeCore.test.js` + fixed schedule | complete | unstarted | none expected |
| CORE-RATES | rate sorting by rate then name | Node core/recording behavior; no focused portable case yet | partial | unstarted | portable tie/rate case still required |
| CORE-CONFLICTS | duplicate exact-system source conflict | Node `bridgeCore.test.js` | complete | unstarted | none expected |
| ROUTE-EXACT | exact `sysId:compId` route lookup | language-neutral route cases | complete: `systemRoutes.test.js` | complete: `routes_test.go` | none |
| ROUTE-EXPIRY | explicit-time route expiration | language-neutral route cases | complete: `systemRoutes.test.js` | complete: `routes_test.go` | none |
| REC-RAW | `base64` JSONL entry dispatches raw bytes | repository recording fixtures | complete: `mixedSitlFixture.test.js` | complete: `reader_test.go` | none |
| REC-EVENT | `event` JSONL entry dispatches lifecycle | parameter-write recording fixture | complete: parameter fixture tests | complete: `reader_test.go` | none |
| REPLAY-FIXED-CLOCK | unpaced raw replay uses every `atMs` explicitly | mixed MAVLink recording | complete: `goConformance.test.js` explicit schedule | partial: reader dispatches exact `atMs`; core blocked | OQ-001/OQ-002 prevent core equality claim |
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
- Phase B: audited `telemetry-frame.schema.json`, `envelope.schema.json`, all 15
  Node decoders, core health behavior, and framing tests. OQ-001 and OQ-002 block
  the output and malformed-accounting gates; see `go_bridge_open_questions.md`.
- Phase C: audited Node `systemRoutes`, recording reader, replay adapter/tests,
  both repository fixtures, and the fixed-clock harness. Exact routes, JSONL
  ownership/dispatch, and finite transmit-free replay are complete. Fixed-core
  equality remains partial because OQ-001 blocks the output boundary and OQ-002
  blocks malformed counter semantics. No additional open question found.
- Phase D: audited both Node parameter routers/codecs/tests, lifecycle schema and
  valid fixtures, and all 32 sanitized parameter-write recording events. Request
  vectors, pure read/list folds, exact-target behavior, retries, passive recorded
  reads, and transmit-free replay rejection are complete. The list evidence row
  remains intentionally partial, and end-to-end published PARAM_VALUE parity is
  blocked by OQ-001. No additional open question found.

The Go folds intentionally retain only active transactions. Completed request IDs
and late-client snapshots remain caller policy; this is the handoff's required
bounded-snapshot deferral rather than an unexplained Node parity difference.
