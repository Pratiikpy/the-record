# THE RECORD

**Cross-chain infrastructure for facts that cannot be self-asserted.**

Three layers, built on Flare. The protocol is never the counterparty — it holds
no float, seeds no liquidity and underwrites nothing.

| Layer | Proves | Status |
|---|---|---|
| **Covenant** | the promises were kept — or provably were not | planned |
| **Procedure** | the books are the books | planned |
| **Reprod** | the code is the code | **scanning live** |

Plan: [`PRD-MASTER.md`](../PRD-MASTER.md) · Design: [`DESIGN.md`](../DESIGN.md)

---

## Reprod

A public register of every confidential-compute machine Flare has on record, and
whether it is really there. Reads only — no keys, no funds, no permission.

```bash
cd packages/reprod
pnpm install
pnpm run build      # scan the chain, probe every proxy, render the register
pnpm run test       # 52 tests
```

### First scan — Coston2 block 33,607,820

- **223** active TEE machines
- **86%** unreachable right now
- **96%** attested to a simulator, binding to no source code
- **8** machines on real confidential hardware — and **not one** of them runs
  code any third party has ever independently reproduced

Full findings, including three corrections we made to our own results:
[`docs/EVIDENCE.md`](docs/EVIDENCE.md).

### Why this is the gap

Flare's own tooling says so, verbatim, in `allow-tee-version/main.go`:

> `NOTE: Code hash is from proxy /info response — not independently verified against attestation`

The code hash an extension owner registers on-chain is whatever the container
said about itself.

### What it does not claim

A proxy serves one `/info`, but many machines share one URL. Where more than one
machine sits behind a URL, its response cannot be attributed to any of them —
those are recorded as `AMBIGUOUS` and never as drift. The register would rather
say nothing than say something it cannot support.

---

## Layout

```
packages/reprod/     chain scanner, liveness prober, verdict engine, renderer
contracts/           ReproRegistry, FailRecord  (in progress)
docs/EVIDENCE.md     dated findings, with corrections
```

## Licence

MIT
