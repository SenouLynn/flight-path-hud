# Go bridge first-slice capability matrix

Statuses are `complete`, `partial`, or `unstarted`. Case IDs are stable and map
only externally observable behavior or important negative paths; ordinary unit
tests do not add rows. Evidence provenance is recorded beside each artifact.

| Case ID | Behavior | Evidence artifact and provenance | Node status/test | Go status/test | Difference |
| --- | --- | --- | --- | --- | --- |
| NORM-HEARTBEAT | HEARTBEAT normalization | `contracts/mavlink/normalization-vectors.json`, MAVLink common dialect layout | unstarted | unstarted | none expected |
| NORM-PARAM-VALUE | PARAM_VALUE normalization | same | unstarted | unstarted | none expected |
| NORM-ATTITUDE | ATTITUDE normalization | same | unstarted | unstarted | none expected |
| NORM-GPS-RAW-INT | GPS_RAW_INT normalization | same | unstarted | unstarted | none expected |
| NORM-GLOBAL-POSITION-INT | GLOBAL_POSITION_INT normalization | same | unstarted | unstarted | none expected |
| NORM-VFR-HUD | VFR_HUD normalization | same | unstarted | unstarted | none expected |
| NORM-COMMAND-ACK | COMMAND_ACK normalization | same | unstarted | unstarted | none expected |
| NORM-MISSION-COUNT | MISSION_COUNT normalization | same | unstarted | unstarted | none expected |
| NORM-MISSION-ITEM-INT | MISSION_ITEM_INT normalization | same | unstarted | unstarted | none expected |
| NORM-MISSION-REQUEST-INT | MISSION_REQUEST_INT normalization | same | unstarted | unstarted | none expected |
| NORM-MISSION-REQUEST | MISSION_REQUEST normalization | same | unstarted | unstarted | none expected |
| NORM-MISSION-CURRENT | MISSION_CURRENT normalization | same | unstarted | unstarted | none expected |
| NORM-MISSION-ACK | MISSION_ACK normalization | same | unstarted | unstarted | none expected |
| NORM-HOME-POSITION | HOME_POSITION normalization | same | unstarted | unstarted | none expected |
| NORM-GPS-GLOBAL-ORIGIN | GPS_GLOBAL_ORIGIN normalization | same | unstarted | unstarted | none expected |
| FRAME-V1 | MAVLink v1 accepted with CRC | normalization vectors plus published X.25 check vector | unstarted | unstarted | none expected |
| FRAME-V2 | unsigned MAVLink v2 accepted with CRC/trailing-zero behavior | normalization vectors, common dialect | unstarted | unstarted | none expected |
| FRAME-SIGNED-V2 | signed v2 rejected | constructed negative vector; Node behavior is not accepted authority | partial: apparent CRC-location defect documented | unstarted | Go deliberately rejects until signature policy exists |
| FRAME-BAD-CRC | bad CRC rejected and resynchronized | constructed corruption of golden frame | unstarted | unstarted | none expected |
| FRAME-TRUNCATED | truncated frame rejected without panic | constructed prefix of golden frame | unstarted | unstarted | none expected |
| FRAME-UNSUPPORTED | valid unsupported message ignored | dialect-derived message id without decoder | unstarted | unstarted | none expected |
| FRAME-JSON | protocol-v0 JSON envelope input | strict envelope contract plus normalization case | unstarted | unstarted | none expected |
| CORE-HEALTH | health on every envelope and counters | fixed-clock schedule | unstarted | unstarted | none expected |
| CORE-SEQUENCE | zero fallback and uint8 wrap | fixed-clock schedule | unstarted | unstarted | protocol-v0 debt retained |
| CORE-ROSTER | sorted roster and strict TTL boundary | fixed-clock schedule | unstarted | unstarted | none expected |
| CORE-RATES | rate sorting by rate then name | fixed-clock schedule | unstarted | unstarted | none expected |
| CORE-CONFLICTS | duplicate exact-system source conflict | fixed-clock schedule | unstarted | unstarted | none expected |
| ROUTE-EXACT | exact `sysId:compId` route lookup | language-neutral route cases | complete: `systemRoutes.test.js` | complete: `routes_test.go` | none |
| ROUTE-EXPIRY | explicit-time route expiration | language-neutral route cases | complete: `systemRoutes.test.js` | complete: `routes_test.go` | none |
| REC-RAW | `base64` JSONL entry dispatches raw bytes | repository recording fixtures | complete: `mixedSitlFixture.test.js` | complete: `reader_test.go` | none |
| REC-EVENT | `event` JSONL entry dispatches lifecycle | parameter-write recording fixture | complete: parameter fixture tests | complete: `reader_test.go` | none |
| REPLAY-FIXED-CLOCK | unpaced raw replay uses every `atMs` explicitly | mixed MAVLink recording | complete: `goConformance.test.js` explicit schedule | partial: reader dispatches exact `atMs`; core blocked | OQ-001/OQ-002 prevent core equality claim |
| REPLAY-NO-SEND | replay API has no outbound-send method | compile/API and behavior tests | complete: replay/router tests | complete: `reader_test.go` reflection/API test | none |
| REPLAY-NO-TIMERS | offline replay creates no goroutines/timers | implementation inspection plus deterministic test | n/a | complete: synchronous `Replay.Dispatch` | Go-only structural gate |
| PARAM-VEC-NAME | PARAM_REQUEST_READ by name payload | `contracts/mavlink/parameter-command-vectors.json`, common dialect | unstarted | unstarted | none expected |
| PARAM-VEC-INDEX | PARAM_REQUEST_READ by index payload | same | unstarted | unstarted | none expected |
| PARAM-VEC-LIST | PARAM_REQUEST_LIST payload | same | unstarted | unstarted | none expected |
| PARAM-READ-NAME | name correlation | Node tests + semantic trace | unstarted | unstarted | none expected |
| PARAM-READ-INDEX | index correlation | Node tests + semantic trace | unstarted | unstarted | none expected |
| PARAM-LIST-START | list start lifecycle | `contracts/semantics/parameter-list-trace.json`, independently reviewed policy trace | unstarted | unstarted | none expected |
| PARAM-LIST-OUT-OF-ORDER | out-of-order values | same | unstarted | unstarted | none expected |
| PARAM-LIST-DUPLICATE | duplicate index replacement/no count advance | same | unstarted | unstarted | none expected |
| PARAM-LIST-PEER | peer-target value ignored | same | unstarted | unstarted | none expected |
| PARAM-LIST-COMPLETE | deterministic index-order completion | same | unstarted | unstarted | none expected |
| PARAM-LIST-IDLE | idle retry then failure | same | unstarted | unstarted | none expected |
| PARAM-ROUTE-LOSS | pending transaction fails on route loss | same | unstarted | unstarted | none expected |
| PARAM-REPLAY | replay request rejected without bytes | same | unstarted | unstarted | none expected |
| PARAM-INVALID-TARGET | broadcast/invalid target rejected | same | unstarted | unstarted | none expected |
| PARAM-RECORDED-READ | passive recorded parameterRead folding | sanitized mixed-SITL parameter-write recording | unstarted | unstarted | none expected |
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
- Phase D: pending; pure lifecycle work may proceed, but end-to-end PARAM_VALUE
  publication inherits OQ-001.
