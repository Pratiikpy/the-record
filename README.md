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

Every confidential-compute project tells its users the same thing: *you do not
have to trust us, check the code hash.* It is a good instruction, and it is
currently unexecutable — because nothing turns 32 bytes into a fact. So we
measured how much a code hash actually identifies:

> **bits = −log₂( machines carrying this hash ÷ machines in the registry )**

- **223** machines carry **8** distinct code hashes between them.
- One value is carried by **215 machines under 44 independent owners** — it
  identifies **0.05 bits**. A unique hash in this registry would carry **7.80**.
  Checking it returns the same answer for every one of them.
- **Not one machine** in the registry carries a hash that can be traced to
  source today: the shared value identifies nothing, and every distinctive hash
  has no claimed source revision. We rebuilt **5 of Flare's own images**
  deterministically and **none of those digests appears on chain**.

Nobody did anything wrong. Simulated attestation is **explicitly permitted** by
Flare, and a shared constant is exactly what simulation is defined to emit. This
measures the *hash*, not the operator — no machine owner is named anywhere in
this repo, and `NOT_A_MEASUREMENT` is derived from how many owners share a
value, never from a list of known constants. It would flag a shared hash nobody
has ever seen, and it would clear the simulator's own constant the moment a
single owner used it. The finding is about a registry three weeks into its life,
not about anyone in it.

```
pnpm --filter @therecord/reprod provenance --registry
pnpm --filter @therecord/reprod provenance <hash | extensionId | address | url>
```

Runs against a committed snapshot — no network, no server, no trust in us.

- **86% of machines are unreachable right now.**
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

- **CV-1** tests five Core Vault controls every period, from entirely public
  data — the allowlist, custodian and balances from Flare, the payments and
  escrow objects from XRPL. No client, no credentials, nobody's permission.
- Live result: **CLEAN**, 11 outflows tested out of 200 transactions. C3
  reconciles Flare's `escrowedFunds` against the sum of the vault's XRPL Escrow
  objects — on live data, **500,000,000,000 on both sides, to the drop**.

**The control has gone red, on purpose.** A monitor that has only ever printed
CLEAN is indistinguishable from one that *cannot* print anything else — and this
project shipped exactly that failure once. So the controls are tested the only
way a control can be:

```
pnpm --filter @therecord/procedure redrun
```

Coston2 is forked, one storage slot is overwritten, and the identical procedure
runs again. The XRP Ledger is left untouched and real — that asymmetry is the
point. C3 flips **CLEAN → EXCEPTION**; the other four controls correctly do not
move. The script **exits non-zero if C3 stays CLEAN**, so a control that stops
being able to fail breaks the build. `FAULT_ESCROW_UBA=<true value>` makes the
fault a no-op and the guard itself trips — verified.

`packages/procedure/src/faults.ts` generalises this into a catalogue: each fault
declares both `mustFire` **and** `mustNotMove`, because a check that fires on
everything is no more informative than one that fires on nothing. It ships a
published list of faults we inject and **do not** catch, because a suite that
catches everything is measuring its own imagination.

> **Three corrections we made to ourselves.** The cross-chain reconciliation has
> been wrong three times. *(i)* It asserted `availableFunds + escrowedFunds ≤
> totalAvailable` across two contracts and reported a 400 UBA **exception
> against Flare** — figures never defined to relate. *(ii)* It asserted
> `escrowedFunds = totalAvailable − immediatelyAvailable`, which held exactly
> and **could never fail**, because both sides derive from one storage slot.
> *(iii)* It asserted `availableFunds + escrowedFunds ≤ Balance` and produced a
> 497,844,875,522 drop shortfall — **caught before publication**: XRPL escrow
> *removes* XRP from the account balance, so that arithmetic double-counts every
> escrow. All three are pinned by regression tests.

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
