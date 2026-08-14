# Offline Go MAVLink bridge slice

This module is an independent, standard-library-only consumer of the repository's
portable MAVLink and protocol-v0 evidence. It intentionally contains no socket,
HTTP/WebSocket, recording-writer, environment, UI, or vehicle-write adapter.

The package boundaries are:

- `internal/mavlink`: frame extraction, CRC, normalization, and read request bytes;
- `internal/bridge`: deterministic bridge health and roster fold;
- `internal/routes`: exact-target route state with caller-supplied time;
- `internal/recording`: finite JSONL input and passive dispatch;
- `internal/transactions`: pure parameter read/list folds; and
- `cmd/conformance`: repository-fixture conformance output/checks.

Pure folds own no goroutines and receive timestamps explicitly. Byte slices retained
beyond a call are copied. The first slice accepts MAVLink v1 and unsigned v2 with
no incompatibility flags. It deterministically rejects signed v2 and every unknown
incompatibility bit; signature verification is later protocol work.

Run through the repository scripts so nested-module working directories stay an
implementation detail:

```sh
pnpm test:bridge-go
pnpm build:bridge-go
pnpm conformance:bridge-go
```

The module requires Go 1.24 and has no third-party dependency or code generator.
