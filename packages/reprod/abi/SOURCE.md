# Vendored ABIs

Copied verbatim from [`flare-foundation/go-flare-common`](https://github.com/flare-foundation/go-flare-common)
at `pkg/contracts/tee/{machinemanager,extensionmanager}/*.abi`.

Vendored rather than fetched at runtime so a scan is reproducible from a clone
alone, and so any drift in the upstream interface shows up as a diff here rather
than as a silent decoding change.

`src/chain.ts` does not use these files directly — it declares only the handful
of methods Reprod actually calls, typed inline for viem. These are kept as the
authoritative reference to check that hand-written subset against.
