# Video pipeline notes

Companion to [ADR-0021](./decisions.md) (video as a first-class sidecar) and
Phase 5b of the [consume plan](./mavlink_gcs_consume_plan.md).

## Layering

Video mirrors the telemetry split exactly:

| layer | telemetry | video |
| --- | --- | --- |
| producer / relay | `apps/mavlink-bridge` (+ `sampleSender.js`) | `apps/video-bridge` |
| pure logic | `gcs-core` folds | `gcs-core/src/video.ts` health folds |
| consumer UI | `apps/gcs` panels | `apps/gcs/src/video/` |

**Camera type, capture device and encoding are upstream and the GCS never learns
about them.** That is the whole point of the split.

The **delivery protocol**, however, does reach the consumer, and pretending
otherwise would be a lie:

| protocol | how the browser consumes it | typical latency | measurable |
| --- | --- | --- | --- |
| multipart / MJPEG | `<img>` | ~100–300 ms | frames only |
| HLS | `<video>` (native in Safari, hls.js elsewhere) | 2–10 s | frames, buffer |
| WebRTC / WHEP | `RTCPeerConnection` → `<video srcObject>` | ~100 ms | frames, bytes, jitter, loss |

Different element, different lifecycle, different statistics, three orders of
magnitude of latency. So adapters are written **per protocol, not per camera**.

The way to make the protocol genuinely upstream is a normalising relay — the video
analogue of what the mavlink-bridge does for wire formats. MediaMTX ingests RTSP,
RTMP, UVC or analog capture and republishes one protocol; with it in the path the
GCS speaks only WHEP and the abstraction is real rather than aspirational.

## What exists today

- **`gcs-core/src/video.ts`** — transport-agnostic health folds: fps, bitrate,
  frame age, stall detection, reconnect counting. Fields an adapter cannot
  measure stay `null` instead of being fabricated. 12 tests.
- **`apps/gcs/src/video/mjpegSource.ts`** — multipart adapter. No media server,
  no signalling; an `<img>` is the whole player. Reports frames; honestly
  declares it cannot measure bitrate or dropped frames.
- **`apps/video-bridge/src/mockCamera.js`** — a moving test pattern served as
  `multipart/x-mixed-replace`, with PNG frames encoded in ~60 lines of `zlib`
  rather than by ffmpeg, so it runs on a stock Node install.

```bash
npm run mock:video     # http://localhost:8090/stream
```

Then enable **Video** in the GCS Views menu. Verified end to end: 45 frames in
3 s at 480x270, 15 fps, consecutive frames differing.

## Likely production capture path: ffmpeg

Recorded as intent, not a commitment, and not built yet. ffmpeg is old, proven and
well supported, and it sits in the **producer** slot — capture device, encode,
serve — which is upstream of the protocol question entirely. It would either serve
multipart directly (replacing the mock one-for-one) or feed MediaMTX for WHEP.

The useful property of the current shape: `mockCamera.js` emits the same protocol
ffmpeg would, so swapping it in is a **producer** change with no consumer change.
The adapter, the health folds and the panel are untouched. That is the test of
whether the seam was drawn in the right place.

## What is deliberately not built

Each of these needs hardware or infrastructure that is not present, and building
them blind would mean shipping a pipeline nobody has watched:

- **MediaMTX** — a new process and deployment surface, and another thing running
  on the Pi.
- **WHEP / WebRTC** — signalling, ICE and codec negotiation. The right end state
  for latency, and the hardest thing to get right unverified.
- **Analog capture and the UVC path** — the plan names an analog receiver over USB
  capture and a Firefly Split PC-CAM. Untestable without the devices.
- **Latency measurement** — the entire point of the low-latency work, and
  unmeasurable without the real chain.

None of it is foreclosed: each is a new adapter behind the same `VideoSource`
port, and the panel above does not change.

## Adding an adapter

Implement `VideoSource` in `apps/gcs/src/video/`:

- `measures` — declare what the transport can actually report, so the UI shows
  `n/a` rather than a plausible zero.
- `start(container, handlers)` — mount, report `onConnectionState` transitions and
  periodic `onStats`, and return a teardown that genuinely closes the connection.
  The MJPEG adapter clears `img.src` for this reason: without it the response
  stays open and the server keeps encoding frames for nobody.
