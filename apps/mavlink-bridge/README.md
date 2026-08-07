# MAVLink Bridge (Phase 3 scaffold)

Minimal UDP -> WebSocket bridge for GCS receive-only development.

## What it does

- Listens for UDP datagrams containing JSON telemetry envelopes.
- Validates and normalizes required fields.
- Broadcasts envelopes to WebSocket clients at `/telemetry`.
- Emits basic stream health counters in each outbound frame.

## Run

From repository root:

```bash
npm run start:bridge
```

Bridge defaults:

- UDP listen: `0.0.0.0:14550`
- WebSocket endpoint: `ws://localhost:8080/telemetry`

## Send sample traffic

In another terminal:

```bash
npm run sample:bridge
```

Then select `External stream (ws)` in GCS Ops and keep URL at
`ws://localhost:8080/telemetry`.

## Envelope shape

Each UDP datagram should be JSON with:

- `recvTimestampMs: number`
- `sysId: number`
- `compId: number`
- `messageName: string`
- `sequence: number`
- `payload: TelemetrySample-like object with timestampMs`

Any malformed datagram is dropped and counted in `decodeErrorCount`.
