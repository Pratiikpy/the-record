# THE RECORD

**Cross-chain infrastructure for facts that cannot be self-asserted.**

Three layers, built on Flare. The protocol is never the counterparty — it holds
no float, seeds no liquidity and underwrites nothing.

| Layer | Proves | Register | Contract |
|---|---|---|---|
| **Covenant** | the promises were kept — or provably were not | `packages/covenant` | `FailRecord.sol` |
| **Procedure** | the books are the books | `packages/procedure` | `AssuranceRegistry.sol` |
| **Reprod** | the code is the code | `packages/reprod` | `ReproRegistry.sol` |

Plan: [`PRD-MASTER.md`](../PRD-MASTER.md) · Design: [`DESIGN.md`](../DESIGN.md) ·
Findings: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

---

## What each layer found, running against live Coston2

### Reprod — the code is the code

- **223** active TEE machines. **86% unreachable right now.** **96% simulated**,
  carrying one shared code hash that binds to no source at all.
- **8** machines on real confidential hardware — and **not one** runs code any
  third party has independently reproduced.
- **5 of 5** Flare images rebuilt from source here, twice each, identical
  digests. Only **2 of 5** are independently verifiable by anyone else.

> **Flare's documented reproducible-build recipe cannot rebuild Flare's own
> extension images.** `REPRODUCIBILITY.md` requires the `docker-container`
> driver, because the default driver silently ignores `rewrite-timestamp`. But
> every language Dockerfile begins `FROM local/tee-node-base:…`, and that driver
> cannot see the host image store. Their CI only works because
> `build-node-base.sh` uses the *other* driver — the one whose output is not
> timestamp-normalised. Resolved here with a throwaway local registry and a
> `--build-context` redirect.

### Covenant — the promises were kept

- **2,367** FXRP redemptions indexed, **2,274** settled, **0** defaults.
- **85.4% already name an executor.** `redemptionPaymentDefault` is permissioned
  to the redeemer, the agent, or an executor appointed at `redeem()` time, so
  that number decides whether the layer has a market. It does.
- Zero defaults is the other half of the answer: nothing to claim on testnet, so
  the failure modes must be manufactured deliberately.

> **A bug in Flare's published reference.** `IAssetManagerEvents.mdx` declares
> `RedemptionPerformed(… uint64 indexed requestId …)`; the deployed contract
> emits `uint256`. An indexer built faithfully from the docs decodes **zero**
> completions and reports every redemption as permanently open.

### Procedure — the books are the books

- **CV-1** tests four Core Vault controls every period, from entirely public
  data — the allowlist, custodian and balances from Flare, the payments from
  XRPL. No client, no credentials, nobody's permission.
- Live result: **CLEAN**, 12 outflows tested out of 200 transactions.

> **A correction we made to ourselves.** C3 first asserted
> `availableFunds + escrowedFunds ≤ totalAvailable` across two contracts and
> reported a 400 UBA **exception against Flare**. Those figures were never
> defined to relate. Escrow reconciles exactly against
> `total − immediatelyAvailable`; the 400 UBA is a fee. A false accusation is
> far more damaging to an assurance register than a missed finding, so that
> regression is pinned by a test.

---

## Design decisions that are load-bearing

**Determinism is not verification.** A rebuild with no on-chain hash to compare
against proves `DETERMINISTIC`, never `REPRODUCED`. The type makes the
overclaim impossible to construct.

**One machine cannot settle reproducibility.** Building twice on one host proves
same-host determinism only. Flare's Python and TypeScript images pass that and
remain unverifiable elsewhere — which is why `ReproRegistry` counts distinct
rebuilders instead of storing a boolean.

**Unknown is not clean.** `failRateBps` returns `total` alongside `bps`;
`coverage` returns `concluded` alongside the counts. A caller cannot mistake
"never adjudicated" for "spotless".

**Suppression, not forgery, is the attack.** Nothing compels a client to relay a
conclusion it dislikes. So `lapse()` is permissionless: once grace closes,
anyone writes the adverse record. A subject can withhold a bad conclusion; it
cannot manufacture a good one on time.

**Say nothing rather than something unsupported.** Many machines share one proxy
URL, and a proxy serves one `/info`. Those comparisons are recorded as
`AMBIGUOUS`, never as drift.

---

## Run it

```bash
pnpm install

# live registers — reads only, no keys, no permission
pnpm -C packages/reprod    build     # scan the TEE register + render
pnpm -C packages/covenant  build     # index redemptions + render
pnpm -C packages/procedure build     # run CV-1 + render

# independent rebuilds (needs Docker + a docker-container buildx builder)
pnpm -C packages/reprod exec tsx src/verify.ts --targets

# verification
pnpm -r run typecheck
pnpm -r run test
cd contracts && forge test && forge coverage --report summary
```

End-to-end against a fork, so the real `FlareTeeManager` and
`AssetManagerFXRP` are present at their real addresses:

```bash
anvil --fork-url https://coston2-api.flare.network/ext/C/rpc --chain-id 114
pnpm -C packages/covenant  e2e
pnpm -C packages/procedure e2e
```

## Test coverage

| Suite | Tests |
|---|---|
| reprod | 81 |
| contracts | 70 — **100% lines, statements, branches, functions** |
| covenant | 44 |
| design | 29 |
| procedure | 29 |
| **Total** | **253** |

Plus 1,536 Solidity fuzz runs across six fuzzed properties.

## The executor

`packages/covenant/src/executor.ts` builds the complete claim for an unresolved
obligation: the `ReferencedPaymentNonexistence` request body from real chain
data, the ABI-encoded request, the target FDC round, and the
`redemptionPaymentDefault` call that follows.

Against the live chain right now: **94 obligations planned, 82 blocked on
nothing but a funded key.** Every plan states its own blocker rather than
assuming one away — `NOT_YET_DUE`, `PROOF_WINDOW_CLOSED`, `NOT_OUR_ROLE`,
`NO_FUNDED_KEY` — and a plan is still built when blocked, because a proof we may
not submit can be handed to whoever may.

```bash
pnpm -C packages/covenant exec tsx src/plan-claims.ts   # prepares, sends nothing
PRIVATE_KEY=0x… pnpm -C packages/covenant exec tsx src/plan-claims.ts
```

## Not done yet

- Mainnet deployment needs a funded key.
- Procedure's enclave execution needs FCC access; the control logic, registry
  and page all run today without it.
- Coston2 indexer credentials (email Flare support) remain the longest-lead
  external dependency.

## Licence

MIT
