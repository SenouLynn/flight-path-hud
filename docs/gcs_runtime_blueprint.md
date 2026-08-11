# GCS Runtime Blueprint (Portable Web + Pi)

This blueprint defines a portable runtime shape for the receive-only MAVLink GCS so the same domain/UI contracts support:

- cloud-relayed browser viewing, and
- Raspberry Pi local direct-link operation.

## Recommended Baseline

Primary stack:
- Frontend: React (existing `apps/hud`)
- Realtime/server hub: Phoenix (Channels)
- MAVLink ingest: adapter process (Node or Go; swappable)

Why this baseline:
- Preserves the current React validation harness and telemetry resolver work.
- Supports high-rate, multi-client fan-out for telemetry streams.
- Keeps ingest transport concerns (UDP/serial/replay) isolated behind adapter ports.

Video extension:
- Treat video as a first-class sidecar using the same ports and adapters discipline.
- Keep video transport and codec choices independent from MAVLink domain logic.

## Architectural Rule Set

1. Domain-first
- Keep telemetry normalization and resolver logic independent of transport and framework.

2. Port-first
- Define ports/interfaces before choosing concrete adapters.

3. Adapter-swappable
- UDP, serial, replay-file, and cloud relay must be replaceable without changing domain contracts.

4. Deployment-neutral
- Local Pi and cloud deployment run the same message envelope and stream semantics.

## Port Model

Input ports:
- `TelemetryIngressPort`
  - Accepts MAVLink bytes/frames from transport adapters.
- `MissionIngressPort`
  - Accepts mission updates/items.

Application ports:
- `TelemetryNormalizationPort`
  - Converts decoded MAVLink messages to canonical `TelemetrySample` (+ provenance).
- `StreamHealthPort`
  - Produces heartbeat age, packet rates, decode/drop counters.

Output ports:
- `GcsStreamPort`
  - Publishes normalized telemetry envelopes to UI subscribers.
- `RecordingPort`
  - Optional sink for deterministic replay capture.

Video ports:
- `VideoIngressPort`
  - Accepts video frames/streams from analog capture or digital camera adapters.
- `VideoRelayPort`
  - Publishes video to local or remote subscribers through a media server.
- `VideoHealthPort`
  - Exposes fps, bitrate, packet loss, reconnect state, and end-to-end latency estimate.

## Video Sidecar Architecture

Goal:
- Support both analog and digital camera paths while presenting one stable video stream contract to the GCS UI.

Input adapter options:
- Analog path:
  - Ground receiver composite/HDMI output into USB capture device on host/Pi.
  - Capture adapter normalizes into a network stream for relay.
- Digital path (Firefly Split PC-CAM):
  - USB UVC capture on edge node or Pi.
  - Optional network device can forward camera stream over LAN before relay.
- Digital path (OpenIPC-based edge camera):
  - OpenIPC device publishes network video to the same relay port contract.
  - Treat OpenIPC transport/protocol specifics as adapter details, not UI/domain concerns.

Current preference note:
- Given likely hardware constraints, prioritize Firefly PC-CAM (UVC) as the default first implementation path.
- Keep OpenIPC as a secondary adapter path for hardware that can support it.

Recommended media stack:
- Media server/router: MediaMTX
  - Useful because it can ingest and serve multiple protocols in one service.
  - Practical protocol mix: RTSP or SRT ingest, WebRTC delivery for low-latency browser viewing, HLS as fallback.
  - Works well as a bridge target for either UVC capture adapters or OpenIPC network streams.
- Capture/transcode adapter: GStreamer or FFmpeg
  - Use as adapter building blocks for USB capture ingest, scaling, bitrate shaping, and protocol output.

UI integration rule:
- React UI should bind to a `VideoStreamPort` style client contract (for example, subscribe by vehicle/session), not to a specific protocol library.

Latency guidance:
- Local Pi target: prefer WebRTC delivery from local MediaMTX for lower latency.
- Cloud-relay target: prefer SRT or RTSP from edge to cloud, then WebRTC to browser.
- Default policy: if multiple paths are available, pick the WebRTC browser delivery path first.

Adapter selection policy (initial):
1. Digital UVC (Firefly PC-CAM) + MediaMTX + WebRTC.
2. Analog receiver + USB capture + MediaMTX + WebRTC.
3. OpenIPC network stream + MediaMTX + WebRTC.

Adapter decision matrix:

| Path | Latency potential | Setup complexity | Hardware risk | Notes |
|---|---|---|---|---|
| Firefly PC-CAM (UVC) -> MediaMTX -> WebRTC | Low | Low to Medium | Medium | Best default path when UVC is stable; straightforward local Pi integration. |
| Analog receiver -> USB capture -> MediaMTX -> WebRTC | Medium | Medium | Medium to High | Useful fallback when digital path is unavailable; capture dongle quality varies. |
| OpenIPC network stream -> MediaMTX -> WebRTC | Low to Medium | Medium to High | Medium | Strong option when OpenIPC hardware is already in your stack; keep as optional adapter. |

Selection heuristics:
- Prefer Firefly PC-CAM first when the host can maintain stable UVC capture under mission load.
- Prefer analog capture when you need broad receiver compatibility over peak quality.
- Prefer OpenIPC when you already have compatible hardware and want a network-native edge camera path.

Telemetry/video alignment:
- Include source timestamps on both telemetry envelopes and video metadata.
- Render stream age and latency indicators beside video to make delay explicit to the operator.

## Runtime Profiles

## Profile A: Local Pi Direct-Link

Use case:
- Pi at the ground station consumes receiver link directly; GUI is available even without internet.

Process layout:
- `mavlink-ingest` (UDP/serial adapters)
- `video-ingest` (analog capture/UVC adapters)
- `stream-hub` (Phoenix)
- `media-router` (MediaMTX)
- `web-ui` (served locally)

Flow:
1. Receiver feeds UDP/serial into ingest adapters.
2. Ingest decodes MAVLink and emits normalized envelopes.
3. Video ingest publishes camera stream to media router.
4. Stream hub fans out telemetry envelopes over channel topics.
5. Local browser/kiosk subscribes and renders HUD/map/mission views plus video.

Optional:
- Relay selected streams upstream when connectivity exists.

## Profile B: Cloud-Relayed Web

Use case:
- Field node forwards telemetry to cloud; users view from remote browser clients.

Process layout:
- Field edge: `mavlink-ingest` + `video-ingest` + relay client
- Cloud: `stream-hub` (Phoenix) + `media-router` + `web-ui`

Flow:
1. Edge node ingests local MAVLink and forwards normalized envelopes.
2. Edge node publishes video stream to cloud media router.
3. Cloud stream hub authorizes clients and broadcasts by vehicle/session topic.
4. Remote browser clients subscribe and render real-time telemetry, missions, and video.

## Topic and Envelope Conventions

Topic naming:
- `gcs:vehicle:<sysId>` for per-vehicle streams
- `gcs:session:<id>` for temporary test sessions

Envelope (minimum):
- `recvTimestampMs`
- `sysId`
- `compId`
- `messageName`
- `sequence`
- `payload` (normalized subset)
- `health` (optional counters/state)

Guideline:
- Keep payload backward-compatible and additive.

## Stub and Test Strategy

Required stubs before full hardware coupling:
- UDP replay stub (SITL)
- Serial mock stub (loopback or fixture frames)
- File replay stub (deterministic regression playback)
- USB camera mock or fixture clip replay for video adapter tests

Contract tests:
- Same fixture stream through UDP stub and file stub yields equivalent normalized output.
- UI stream behavior is identical regardless of ingest adapter.

Failure-mode tests:
- heartbeat timeout
- out-of-order sequence/timestamps
- reconnect/backoff behavior
- burst traffic throttling for UI render stability
- video stream disconnect and auto-reconnect
- degraded bandwidth profile (lower bitrate/fps)

## Security and Reliability Notes

- Authenticate channel subscriptions in cloud mode.
- Isolate vehicle/session topics to prevent cross-stream leakage.
- Add supervised restart strategy for ingest and stream hub processes.
- Surface stale-feed warnings from heartbeat age thresholds.
- Gate video stream access with the same auth scope used for telemetry topics.
- Keep video relay and telemetry hub independently restartable.

## Suggested Repository Evolution

Near-term additions:
- `apps/mavlink-bridge/` (initial ingest adapter process)
- `apps/stream-hub/` (Phoenix app, when started)
- `apps/hud/src/stream/wsTelemetrySource.ts` (UI adapter)
- `apps/video-bridge/` (capture/transcode adapter process)

Domain contracts should remain in shared, framework-neutral modules.

## Milestone Exit Criteria

M1: Adapter contract locked
- Port interfaces and envelope schema tested with fixtures.

M2: Local Pi profile works
- Local ingest + local stream hub + local web UI operational from SITL.

M3: Cloud profile works
- Edge relay to cloud hub with remote browser subscribers and stream health visibility.

M4: Adapter parity
- UDP, serial-mock, and file-replay adapters pass the same contract suite.
