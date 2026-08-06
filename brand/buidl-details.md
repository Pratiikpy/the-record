> **THE RECORD** — three public registers on Flare that answer questions the interested party is not allowed to answer about itself: **did you pay**, **are the books real**, **is this the code you published**.
>
> Running against **Flare mainnet**, over **140,000,000 XRP** of real escrowed value. Every figure is re-derivable from public RPC by anyone — no credentials, no client, nobody's permission.

| | |
|---|---|
| 🎬 **Film (66s)** | https://youtu.be/W-KmIFQ6P9s |
| 🌐 **Live app** | https://the-record.vercel.app |
| 📋 **Proof deck** — every feature beside its evidence | https://the-record.vercel.app/proof-deck |
| ⚠️ **Errata** — everything we got wrong | https://the-record.vercel.app/errata |
| 💻 **GitHub** | https://github.com/Pratiikpy/the-record |
| 📗 **Full submission** | [Notion write-up](https://comfortable-goal-205.notion.site/THE-RECORD-Flare-Summer-Signal-submission-3b39c0ce787681518236e914f2decc49) |
| 🔌 **JSON API** | https://the-record.vercel.app/api/status.json |

**Entering both bounties** — Interoperable Asset Products *and* Confidential Compute Apps.

---

## The problem

Three questions decide whether FXRP is safe to hold. In every case the party who knows the answer is the party who cannot credibly give it.

- **Did the redemption agents actually pay?** The agent reports its own performance.
- **Are the books real?** The Core Vault reports its own backing.
- **Is this the code you published?** The operator reports its own code hash.

Every confidential-compute project says *"don't trust us, check the code hash."* It is a good instruction and it is **currently unexecutable** — nothing turns 32 bytes into a fact.

So the gap is not monitoring. It is that **assurance today requires the subject's cooperation**, and a monitor that needs permission is not assurance. THE RECORD needs none: it reads public state on Flare and the XRP Ledger, and **is never the counterparty** — it holds no float, seeds no liquidity and underwrites nothing.

---

## Three findings nobody had published

### 1 · "Check the code hash" has no answer yet

We measured how much a code hash actually identifies:

> **bits = −log₂( machines carrying this hash ÷ machines in the registry )**

```
Flare TEE registry — chain 114, block 33682349, 2026-08-06

  machines                 268
  distinct code hashes      14
  mean identification     0.49 bits   (a unique hash here would carry 8.07)

  most-shared hash carried by 254 machines (94.8%)
  under 47 independent owners            → 0.08 bits

  rebuilds we performed        5
  that match an on-chain hash  0
```

**Not one machine** in the registry carries a hash traceable to source. We rebuilt **5 of Flare's own OCI images** deterministically as a third party and **none of those digests appears on chain**.

**Nobody did anything wrong.** Simulated attestation is explicitly permitted, and a shared constant is exactly what simulation is defined to emit. This measures the *hash*, not the operator — **no machine owner is named anywhere in the repo**, and `NOT_A_MEASUREMENT` derives from how many owners share a value, never from a list of known constants.

### 2 · The Core Vault's allowlist was empty for three months

CV-1 is a pure function of chain state at a height — so the register **did not wait for history, it computed it**: 119 Coston2 heights across 238 days plus 46 mainnet heights, every row labelled `retrospective`.

It reports **42 exceptions**. `getAllowedDestinationAddresses()` returned an **empty list** for the vault's first three months, so the outflow-destination control would have passed **vacuously** that entire window.

Verify it yourself, one call, no trust in us:

```sh
cast call --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  --block 27444811 0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b \
  "getAllowedDestinationAddresses()(string[])"
# []
```

Anyone whose monitoring began this summer sees a healthy allowlist and **has no way to learn this happened**.

### 3 · A naive FXRP backing check accuses honest agents

CV-1 reconciles the Core Vault. Nobody reconciled the **agents** — and the agents are where a redemption is actually paid from. **AB-1** asks the same question one level down, for every FXRP agent: does the XRP Ledger hold what Flare says it holds?

Do it the obvious way and you accuse a **solvent** agent of insolvency, on mainnet, with real money. We caught it happening:

```
t1  flare 408,410.89 | xrpl 394,344.37 | diff -14,066.52   <- false shortfall
t2  flare 393,423.10 | xrpl 394,344.37 | diff    +921.27   <- truth, 45s later
```

An agent pays a redemption on the XRP Ledger **first**. Flare's `underlyingBalanceUBA` only falls once that payment is confirmed back on Flare. Inside that window the agent looks short by exactly the payment in flight — Flare fell by **14,987.784 XRP** between those two readings, matching **to the drop** the payment already made at XRP Ledger **106,099,993**. That equality is what makes it settlement lag rather than coincidence.

So a shortfall is **never** published from a single observation. It is a *candidate*, re-read across a **settle bracket**, and confirmed only if every reading is short. Anything that resolves is a `DISCLAIMER` naming the skew.

Two structural facts fall out of the same scan:

- **98.76% of FXRP is not backed by agents.** Six agents back 1.86M XRP of a 149.2M supply; the rest is the Core Vault — exactly what CV-1 tests.
- Every agent is currently **over**-backed. Fleet opinion `CLEAN`.

---

## The part that matters most: the control has gone red, on purpose

**A monitor that has only ever printed CLEAN is indistinguishable from one that *cannot* print anything else — and this project shipped exactly that failure once.**

C3 asserted `escrowedFunds = totalAvailable − immediatelyAvailable`. It held exactly, every period. It also **could never fail**, because `coreVaultAvailableAmount()` derives *both* sides from the same storage slot. Fault injection moved both together and the control stayed green.

```
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

Coston2 is forked, one storage slot overwritten, the identical procedure rerun. The XRP Ledger is left **untouched and real** — that asymmetry is the point. **Four controls correctly do not move**, because a check that fires on everything is no more informative than one that fires on nothing.

The script **exits non-zero if C3 stays CLEAN**, and it runs in CI — so a control that stops being able to fail **breaks the build**. `faults.ts` generalises this into a catalogue of **9 faults**, each declaring `mustFire` **and** `mustNotMove`, plus **3 faults we inject and publish that we do not catch** — because a suite that catches everything is measuring its own imagination.

---

## How much can a stranger check? A scale, not a safety rating

| Tier | Means | Graded |
|---|---|---|
| **V0** `ASSERTED` | the system states facts about itself; you take its word | |
| **V1** `OBSERVABLE` | the facts are public, a stranger can read them | **Flare TEE registry** |
| **V2** `RECONCILED` | two independent sources agree, and disagreement would show | |
| **V3** `FALSIFIED` | the check is proven able to fail, on the record, recently | **FXRP core vault** |

V3 exists because a reconciliation nobody has seen fail is indistinguishable from one that *cannot* fail — and **V2 is exactly where our own tautology lived comfortably**. It **lapses after 30 days**. The tier can go down, ours included.

---

## How it uses Flare — not superficially

| Primitive | How |
|---|---|
| **FDC** `ReferencedPaymentNonexistence` | Covenant asks the Data Connector to *prove a payment did not happen*, then requires the verifier to **refuse** redemptions the chain already recorded as performed. That refusal test caught our own false accusation. |
| **FAssets / Core Vault** | CV-1 reads `CoreVaultManager` + `AssetManagerFXRP` and reconciles `escrowedFunds` against the vault's actual **XRPL Escrow ledger objects** — two chains that cannot move each other. |
| **FAssets agents** | AB-1 resolves `getAgentInfo` through the **EIP-2535 diamond loupe** at run time and reconciles all six agents against their own XRPL addresses. |
| **Flare Contract Registry** | Nothing is hardcoded but the registry itself. Registry → `AssetManagerController` → `getAssetManagers()` → `getCoreVaultManager()`, resolved at run time, asset picked by the token's own symbol. **A new FAsset is discovered, not missed.** |
| **FlareTeeManager** (FCC) | Reprod enumerates every registered TEE machine and measures what each code hash establishes. `doctor` live-probes all of them — **216 of 268 did not answer**, mostly dead ngrok tunnels still registered on chain. |
| **Reproducible builds** | Rebuilt **5 of Flare's own OCI images** deterministically, and fixed the published recipe when it did not work. |

---

## What was newly built during the program

| Built | Detail |
|---|---|
| All three registers | Covenant, Procedure, Reprod — from zero |
| **AB-1 agent backing** | Reconciles every FXRP agent against its XRPL address, with a settle bracket so an in-flight redemption is never published as a shortfall |
| The provenance instrument | Measures what a TEE code hash establishes; CLI + API + page |
| The red run + fault catalogue | 9 faults, each declaring `mustFire` **and** `mustNotMove`, plus 3 declared *known uncaught* |
| The backfill engine | History computed from chain state, with a cross-chain skew bracket |
| The verifiability scale | V0–V3, graded from evidence, lapses after 30 days |
| `doctor` | Live-probes every TEE machine, returns the blocker, the fix, **and the source for the fix** |
| `drift` | Asks whether our published snapshot still describes the chain; blocks the publish on `MATERIAL` **and on `UNKNOWN`** |
| `verify` | Rebuilds an opinion with `fetch` replaced by a **throwing stub** — a missing read fails the rebuild rather than silently defaulting |
| Distribution layer | Embeddable badges + versioned JSON API |
| Proof deck + 66s film | Both **rendered from the registers' own figures**, not narrated over them |
| Errata | Eight entries, permanent, append-only |
| Two upstream PRs | Into Flare's own repositories |

---

## Fixes sent upstream to Flare

| PR | What was wrong |
|---|---|
| [developer-hub#1455](https://github.com/flare-foundation/developer-hub/pull/1455) | `RedemptionPerformed.requestId` documented as `uint64`, emitted as `uint256`. It is an **indexed** parameter, so the type is part of the topic hash — an indexer written faithfully from the docs matches **nothing** and every redemption looks permanently open. We diffed all 25 documented events; this was the only mismatch. |
| [fce-extension-scaffold#3](https://github.com/flare-foundation/fce-extension-scaffold/pull/3) | The reproducible-build verification procedure **cannot be followed**: the clone step 404s, `-f Dockerfile` has no matching file, and the build cannot resolve `local/tee-node-base` under the very driver the doc requires. |

Both were found by using Flare's own documentation as a third party and having it fail.

---

## Deployment

| Contract | Coston2 address |
|---|---|
| AssuranceRegistry | `0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439` |
| ReproRegistry | `0x7EfCBb20DC125A8322FCF862C04AcF97b0c1f70B` |
| FailRecord | `0x5f623912D4dFA8d4d702cA77754a3517B4FA4c56` |

Reads **Flare Mainnet** (chain 14); contracts deployed to **Coston2**, which is also the fault laboratory and must be asked for by name.

**CV-1 is registered and concluded on chain.** Procedure id `0x72c9a9c291cbcaecfbdbb925235ca114c4d85aad22453bd31e30be4c11856564`, subject = the **mainnet** Core Vault manager `0x6c8d96dEfE4cbEE05FA969Fc0Ac436d94Fc21784`, opinion **CLEAN**, evidence digest `0x77377318`.

`lapse()` is **permissionless**: if a reporter goes silent past the grace window, **any stranger can write the adverse record**. Suppression becomes the record.

---

## Everything we got wrong

**Eight errata. Four reached the public before being withdrawn.** → https://the-record.vercel.app/errata

Including a claim that **93 redemption agents had defaulted when every one of them had paid**, in full and on time.

Each entry names the exact wrong value, the mechanism, how it was caught, and the test that now makes it unconstructable. A retraction is the cheapest thing to fake and the **hardest thing to fake precisely**.

> Three of the eight are the same error in different clothes: a comparison between two numbers that were never defined to be equal, or that could never disagree. That is the failure mode of assurance work, and it is invisible from the inside — every one produced confident, well-formatted output that happened to be **meaningless**.

---

## Honest limitations

- **Zero real defaults exist on FXRP today.** Covenant's failure path is exercised by deliberate fault injection, not by live defaults. We say so rather than implying otherwise.
- **Covenant cannot be backfilled.** FDC proofs expire at `lutlimit` (~14 days), so historical rounds cannot be re-proven at any price. The record states this instead of quietly omitting the layer.
- **Three faults are declared uncaught**, in `faults.json` as data, not in a footnote.
- **No users yet.** This is a register weeks old with no distribution history. The badge and API exist precisely because that is the gap.
- **A tier is not a safety rating.** V3 means the check has been proven able to fail — not that nothing will.

---

## Roadmap

1. **Coverage as the product** — every FXRP agent and every TEE machine gets a permanent, citable record
2. **Alerts** — a feed of exceptions, so the record comes to you
3. **Permanence** — content-address the evidence; a record that can vanish is not a record
4. **Community procedures** — a DSL so others can write controls, not just us
5. **Skin in the game** — agents stake; a proven default slashes. Turns a report into a market
6. **FBTC / FDOGE** the day they launch — already auto-discovered through the registry

---

## Verify it yourself

```sh
git clone https://github.com/Pratiikpy/the-record && cd the-record && pnpm install

pnpm -r run test                                       # 544 tests, all packages
cd contracts && forge test                             # 70 Solidity tests (614 in total)

pnpm --filter @therecord/procedure run run             # CV-1 against Flare MAINNET
pnpm --filter @therecord/procedure redrun              # the red run: CLEAN → EXCEPTION
pnpm --filter @therecord/procedure agents              # AB-1: every FXRP agent vs the XRP Ledger
pnpm --filter @therecord/reprod provenance --registry  # the TEE measurement
```

Four more, in descending order of how much they distrust us:

```sh
pnpm --filter @therecord/procedure verify           # re-derive an opinion with the network unplugged
pnpm --filter @therecord/reprod drift               # is our published snapshot still true of the chain?
pnpm --filter @therecord/doctor doctor --worst 5    # the 5 worst-configured TEE machines, live-probed
pnpm --filter @therecord/procedure spec             # emit the machine-readable fault spec
```

**`verify` is the one to run if you only run one.** It takes a published evidence pack, replaces `fetch` with a function that throws, and rebuilds the opinion from the recorded reads alone — so the pack is either **sufficient or rejected**, never quietly topped up from the network.

**`drift` is the one that can embarrass us, which is why it ships.** It refused one of our own deploys during this build when the TEE registry moved past the materiality threshold. We re-scanned rather than overriding. **A gate that has never refused anything is not a gate.**

---

> **Final read.** The hard part of assurance is not producing output — it is producing output that **could have come out differently**.
>
> That is why the red run exists, why it runs in CI, and why the top tier of our own scale requires it.
>
> **Open the errata page first.** It is the part nobody else can copy, because copying it requires having been wrong in public.
