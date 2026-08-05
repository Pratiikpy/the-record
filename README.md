<div align="center">

# THE RECORD

### Facts that cannot be self-asserted.

Three registers on Flare, each answering a question the interested party
is not allowed to answer about itself.

**did you pay** · **are the books real** · **is this the code you published**

<br/>

[![core vault](https://the-record.vercel.app/badge/core-vault.svg)](https://the-record.vercel.app/procedure/)
[![tee registry](https://the-record.vercel.app/badge/tee-registry.svg)](https://the-record.vercel.app/reprod/)

**[Live site](https://the-record.vercel.app)** ·
**[Proof deck](https://the-record.vercel.app/proof-deck)** ·
**[Errata](https://the-record.vercel.app/errata)** ·
**[API](https://the-record.vercel.app/api/status.json)** ·
**[Submission](https://comfortable-goal-205.notion.site/THE-RECORD-Flare-Summer-Signal-submission-3b39c0ce787681518236e914f2decc49)**

</div>

---

Running against **Flare mainnet**, over **140,000,000 XRP** of real escrowed
value. Every figure is re-derivable from public RPC by anyone — no credentials,
no client, nobody's permission. That is the whole wedge: continuous assurance
that can start without being invited.

The protocol is never the counterparty. It holds no float, seeds no liquidity
and underwrites nothing.

| Layer | Proves | Register | Contract |
|---|---|---|---|
| **Covenant** | the promises were kept — or provably were not | `packages/covenant` | `FailRecord.sol` |
| **Procedure** | the books are the books | `packages/procedure` | `AssuranceRegistry.sol` |
| **Reprod** | the code is the code | `packages/reprod` | `ReproRegistry.sol` |

---

## How much can a stranger check?

A verdict says what a check found today. It does not say how much of the system
you could establish yourself. So there is a scale for that — deliberately **not**
a safety rating.

| Tier | Means | Graded |
|---|---|---|
| **V0** `ASSERTED` | the system states facts about itself; you take its word | |
| **V1** `OBSERVABLE` | the facts are public, a stranger can read them | **Flare TEE registry** |
| **V2** `RECONCILED` | two independent sources agree, and disagreement would show | |
| **V3** `FALSIFIED` | the check is proven able to fail, on the record, recently | **FXRP core vault** |

**V3 exists because a reconciliation nobody has seen fail is indistinguishable
from one that _cannot_ fail** — and V2 is exactly where the tautology we shipped
lived comfortably. It **lapses after 30 days**. The tier can go down, ours
included.

---

## Two findings

### “Check the code hash” has no answer yet

Every confidential-compute project tells its users the same thing: *you don't
have to trust us, check the code hash.* Good instruction — currently
unexecutable, because nothing turns 32 bytes into a fact.

So we measured how much a hash actually identifies:

> **bits = −log₂( machines carrying this hash ÷ machines in the registry )**

```console
$ pnpm --filter @therecord/reprod provenance --registry

  Flare TEE registry  chain 114 · block 33658305 · 2026-08-05

  machines                 256
  distinct code hashes     13
  mean identification      0.47 bits  (a unique hash here would carry 8.00)

  most-shared hash
  0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2
  carried by 243 machines (94.9%) under 46 independent owners → 0.08 bits

  rebuilds we performed       5
  that match an on-chain hash 0
```

The registry grows daily, so the block above is a **dated observation** and the
command is the claim. Run it and you will get today's figures; the finding — that
almost the whole fleet shares one value, and that no on-chain hash is traceable to
source — is what has held across every scan.

**Not one machine** in the registry carries a hash traceable to source. We
rebuilt **5 of Flare's own images** deterministically and **none of those digests
appears on chain**.

**Nobody did anything wrong.** Simulated attestation is explicitly permitted, and
a shared constant is exactly what simulation is defined to emit. This measures
the *hash*, not the operator — no machine owner is named anywhere in this repo,
and `NOT_A_MEASUREMENT` derives from how many owners share a value, never from a
list of known constants. It would flag a shared hash nobody has ever seen, and
clear the simulator's own constant the moment one owner used it.

### The Core Vault's allowlist was empty for three months

CV-1 is a pure function of chain state at a height — so the register did not wait
for history, it **computed** it. 119 Coston2 heights across 238 days plus 46
mainnet heights, every row labelled `retrospective`.

It reports **42 exceptions**. `getAllowedDestinationAddresses()` returned an
**empty list** for the vault's first three months, so the outflow-destination
control would have passed vacuously that entire window.

```sh
cast call --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  --block 27444811 0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b \
  "getAllowedDestinationAddresses()(string[])"
# []
```

Anyone whose monitoring began this summer sees a healthy allowlist and has no way
to learn this happened.

---

## The control has gone red, on purpose

```console
$ pnpm --filter @therecord/procedure redrun

  injecting fault: slot 26 [escrowed:high][available:low]
    escrowedFunds 480000000000 → 999999999999

  ─── RED — same procedure, corrupted escrow figure ───
    CLEAN      C1  Outflow destination allowlist
    CLEAN      C2  Control preconditions
    EXCEPTION  C3  Escrow backing
    CLEAN      C4  Liquid backing
    CLEAN      C5  Available-funds wedge

  ✓ the control fires. CLEAN → EXCEPTION on a single corrupted storage slot.
```

Coston2 is forked, one storage slot overwritten, the identical procedure rerun.
The XRP Ledger is left untouched and real — that asymmetry is the point. **Four
controls correctly do not move**, because a check that fires on everything is no
more informative than one that fires on nothing.

The script **exits non-zero if C3 stays CLEAN**, so a control that stops being
able to fail breaks the build. `FAULT_ESCROW_UBA=<true value>` makes the fault a
no-op and the guard itself trips — verified.

`packages/procedure/src/faults.ts` generalises this into a catalogue: 9 faults,
each declaring `mustFire` **and** `mustNotMove`, plus a published list of faults
we inject and **do not** catch — because a suite that catches everything is
measuring its own imagination.

---

## Everything we got wrong

**[Read the errata →](https://the-record.vercel.app/errata)**

Eight entries, **four of which reached the public** before being withdrawn —
including a claim that 93 redemption agents had defaulted when every one of them
had paid, in full and on time.

Each names the exact wrong value, the mechanism, how it was caught, and the test
that now makes it unconstructable. A retraction is the cheapest thing to fake and
the hardest thing to fake *precisely*.

> Three of the eight are the same error in different clothes: a comparison between
> two numbers that were never defined to be equal, or that could never disagree.
> That is the failure mode of assurance work, and it is invisible from the inside
> — every one produced confident, well-formatted output that happened to be
> meaningless.

---

## How it uses Flare

| Primitive | How, not superficially |
|---|---|
| **FDC** `ReferencedPaymentNonexistence` | Covenant proves a payment *did not happen*, then requires the verifier to **refuse** redemptions the chain already recorded as performed. That refusal test caught our own false accusation. |
| **FAssets / Core Vault** | CV-1 reconciles `escrowedFunds` against the vault's actual XRPL Escrow objects — two chains that cannot move each other. |
| **Contract Registry** | Nothing hardcoded but the registry. Registry → `AssetManagerController` → `getAssetManagers()` → `getCoreVaultManager()`, resolved at run time; asset picked by the token's own symbol, so a new FAsset is discovered rather than missed. |
| **FlareTeeManager** | Reprod enumerates every registered TEE machine and measures what each code hash establishes. |
| **Reproducible builds** | Rebuilt 5 of Flare's own OCI images as a third party — and fixed the published recipe when it didn't work. |

### Fixes sent upstream to Flare

| PR | What was wrong |
|---|---|
| [developer-hub#1455](https://github.com/flare-foundation/developer-hub/pull/1455) | `RedemptionPerformed.requestId` documented as `uint64`, emitted as `uint256`. It is **indexed**, so the type is part of `topic0` — an indexer written faithfully from the docs matches **nothing** and every redemption looks permanently open. Diffed all 25 documented events; the only mismatch. |
| [fce-extension-scaffold#3](https://github.com/flare-foundation/fce-extension-scaffold/pull/3) | The reproducible-build verification procedure cannot be followed: the clone step **404s**, `-f Dockerfile` has no matching file, and Python/TypeScript cannot resolve `local/tee-node-base` under the `docker-container` driver the doc itself requires. |

Both were found by using Flare's own documentation as a third party and having it
fail.

---

## Deployment

Reads **Flare Mainnet** (chain 14). Contracts on **Coston2**.

| Contract | Coston2 |
|---|---|
| `AssuranceRegistry` | [`0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439`](https://coston2.testnet.flarescan.com/address/0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439) |
| `ReproRegistry` | [`0x7EfCBb20DC125A8322FCF862C04AcF97b0c1f70B`](https://coston2.testnet.flarescan.com/address/0x7EfCBb20DC125A8322FCF862C04AcF97b0c1f70B) |
| `FailRecord` | [`0x5f623912D4dFA8d4d702cA77754a3517B4FA4c56`](https://coston2.testnet.flarescan.com/address/0x5f623912D4dFA8d4d702cA77754a3517B4FA4c56) |

CV-1 is registered **and concluded** on chain — procedure `0x72c9a9c2…11856564`,
subject the **mainnet** Core Vault manager `0x6c8d96dE…4Fc21784`, opinion
**CLEAN**, evidence digest `0x77377318`.

Coston2 is not the subject — it is the **fault laboratory**, and must be asked
for by name (`NETWORK=coston2`) so a fault-injection run can never be mistaken
for a reading of production.

---

## Design decisions that are load-bearing

**Determinism is not verification.** A rebuild with no on-chain hash to compare
against proves `DETERMINISTIC`, never `REPRODUCED`. The type makes the overclaim
impossible to construct.

**One machine cannot settle reproducibility.** Building twice on one host proves
same-host determinism only. Flare's Python and TypeScript images pass that and
remain unverifiable elsewhere — which is why `ReproRegistry` counts distinct
rebuilders instead of storing a boolean.

**Unknown is not clean.** `failRateBps` returns `total` alongside `bps`;
`coverage` returns `concluded` alongside the counts. A caller cannot mistake
"never adjudicated" for "spotless".

**Suppression, not forgery, is the attack.** Nothing compels a client to relay a
conclusion it dislikes. So `lapse()` is **permissionless**: once grace closes,
anyone writes the adverse record. A subject can withhold a bad conclusion; it
cannot manufacture a good one on time.

**Say nothing rather than something unsupported.** Many machines share one proxy
URL, and a proxy serves one `/info`. Those comparisons are recorded as
`AMBIGUOUS`, never as drift.

---

## Run it yourself

```sh
git clone https://github.com/Pratiikpy/the-record && cd the-record && pnpm install

pnpm -r run test                                       # 491 tests, all packages
cd contracts && forge test                             # 70 Solidity tests (561 in total)

pnpm --filter @therecord/procedure run run             # CV-1 against Flare MAINNET
pnpm --filter @therecord/procedure redrun              # the red run: CLEAN → EXCEPTION
pnpm --filter @therecord/reprod provenance --registry  # the TEE measurement
```

Four more that are worth your time, in descending order of how much they
distrust us:

```sh
pnpm --filter @therecord/procedure verify              # re-derive an opinion with the network unplugged
pnpm --filter @therecord/reprod drift                  # is our published snapshot still true of the chain?
pnpm --filter @therecord/doctor doctor --worst 5       # the 5 worst-configured TEE machines, live-probed
pnpm --filter @therecord/procedure spec                # emit the machine-readable fault spec
```

`verify` is the one to run if you only run one. It takes a published evidence
pack, replaces `fetch` with a function that throws, and rebuilds the opinion from
the recorded reads alone. If any read were missing the rebuild would fail rather
than quietly substitute a default, so the pack is either sufficient or it is
rejected. `provenance` likewise runs against a committed snapshot — no network,
no server, no trust in us.

`drift` is the one that can embarrass us, which is why it ships. It asks whether
the chain has moved past the numbers on the site and prints `MATERIAL` if it has.
We published `223` for twenty-nine hours while the registry held `250`; that is
[E-008](https://the-record.vercel.app/errata), and this command exists so it
cannot happen silently twice.

End-to-end against a fork, so the real `FlareTeeManager` and `AssetManagerFXRP`
are present at their real addresses:

```sh
anvil --fork-url https://coston2-api.flare.network/ext/C/rpc --chain-id 114
pnpm -C packages/covenant  e2e
pnpm -C packages/procedure e2e
```

| Suite | Tests |
|---|---|
| design | 156 |
| reprod | 105 |
| procedure | 68 |
| covenant | 45 |
| doctor | 21 |
| contracts | 70 — **100% lines, statements, branches, functions** |

Plus 1,536 Solidity fuzz runs across six fuzzed properties. CI re-runs daily
against the real chain, because a green build on stale code is not evidence.

---

## What this will not do

**Say more than the evidence supports.** Unresolved is not unpaid. Determinism is
not verification. Unknown is not clean. Each register refuses to conclude where it
cannot, and records that refusal rather than rounding it up to a pass.

Stated limits, in full:

- **Zero real defaults exist on FXRP today.** Covenant's failure path is
  exercised by deliberate fault injection, not by live defaults.
- **Covenant cannot be backfilled.** FDC proofs expire at `lutlimit` (~14 days),
  so historical rounds cannot be re-proven at any price.
- **The skew bracket has never suppressed anything** across 165 heights — which
  is why it is a pure function with tests proving it *can*.
- **Procedure's enclave execution needs FCC access.** The control logic, registry
  and page all run today without it.
- **Covenant reads Coston2, not mainnet.** Proving a payment did *not* happen
  needs an FDC verifier; the testnet one accepts the documented public key and
  the mainnet one answers `403`. That is a credential we do not have, not a
  design choice.
- **No users yet.** The badge and API exist precisely because that is the gap.

---

<div align="center">

Plan: [`PRD-MASTER.md`](../PRD-MASTER.md) ·
Design: [`DESIGN.md`](../DESIGN.md) ·
Findings: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

MIT

</div>
