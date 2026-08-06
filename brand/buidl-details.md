Three public registers on Flare that answer questions the interested party is not allowed to answer about itself:

**did you pay** · **are the books real** · **is this the code you published**

Running against **Flare mainnet**, over **140,000,000 XRP** of real escrowed value. Every figure is re-derivable from public RPC by anyone — no credentials, no client, nobody's permission. Entering **both bounties**.

| | |
|---|---|
| **Full write-up** — the complete submission, requirement by requirement | **https://comfortable-goal-205.notion.site/THE-RECORD-Flare-Summer-Signal-submission-3b39c0ce787681518236e914f2decc49** |
| Proof deck — every feature beside its evidence | https://the-record.vercel.app/proof-deck |
| Errata — everything we got wrong | https://the-record.vercel.app/errata |

*Everything below is the short version. The write-up above has the full detail.*

---

## The problem

Three questions decide whether FXRP is safe to hold. In each case, the party who knows the answer is the party who cannot credibly give it. The agent reports its own performance. The vault reports its own backing. The operator reports its own code hash.

The gap is not monitoring. It is that assurance requires the subject's cooperation — and a monitor that needs permission is not assurance.

This needs none. It is also never the counterparty: no float, no liquidity, underwrites nothing.

---

## Three findings

### 1 · "Check the code hash" has no answer yet

Every confidential-compute project says *don't trust us, check the code hash*. Good instruction, currently unexecutable — nothing turns 32 bytes into a fact. So we measured what a hash identifies:

> bits = −log₂( machines carrying this hash ÷ machines in registry )

| Flare TEE registry — block 33682349 | |
|---|---|
| Machines | **268** |
| Distinct code hashes | **14** |
| Most-shared hash | **254 machines (94.8%)** under **47 owners** |
| What that identifies | **0.08 bits** — a unique hash would carry 8.07 |
| Our rebuilds matching an on-chain hash | **0 of 5** |

**Not one machine** carries a hash traceable to source. We rebuilt five of Flare's own images deterministically; none of those digests appears on chain.

Nobody did anything wrong — simulation is permitted and a shared constant is what it emits. This measures the *hash*, not the operator: no owner is named anywhere in the repo.

### 2 · The Core Vault's allowlist was empty for three months

CV-1 is a pure function of chain state at a height, so the register didn't wait for history — it **computed** it. 119 Coston2 heights across 238 days, plus 46 mainnet heights.

It reports **42 exceptions**. `getAllowedDestinationAddresses()` returned an **empty list** for the vault's first three months, so the outflow control had nothing to check against and passed **vacuously** that whole window.

```sh
cast call --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  --block 27444811 0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b \
  "getAllowedDestinationAddresses()(string[])"
# []
```

Anyone whose monitoring began this summer sees a healthy allowlist and no way to learn this happened.

### 3 · A naive FXRP backing check accuses honest agents

Nothing reconciled the **agents** — and agents are where redemptions are actually paid from. AB-1 asks: does the XRP Ledger hold what Flare says it holds?

Do it the obvious way and you accuse a **solvent** agent of insolvency, on mainnet. We caught it live:

```
t1  flare 408,410.89 | xrpl 394,344.37 | diff -14,066.52   <- false shortfall
t2  flare 393,423.10 | xrpl 394,344.37 | diff    +921.27   <- truth, 45s later
```

Agents pay on the XRP Ledger **first**; Flare's `underlyingBalanceUBA` only falls once the payment is confirmed back on Flare. Flare fell by **14,987.784 XRP** between those readings — matching, to the drop, the payment already made at XRP Ledger **106,099,993**. That equality is what makes it settlement lag, not coincidence.

So a shortfall is never published from one observation. It is a *candidate*, re-read across a **settle bracket**, confirmed only if every reading is short.

Two structural facts fall out of the same scan:

- **98.76% of FXRP is not backed by agents.** Six agents back 1.86M of a 149.2M supply — the rest is the Core Vault, which is exactly what CV-1 tests.
- Every agent is currently **over**-backed. Fleet opinion `CLEAN`.

---

## The control has gone red, on purpose

A monitor that has only ever printed CLEAN is indistinguishable from one that **cannot** print anything else. We shipped exactly that failure once: C3 compared two numbers both derived from the same storage slot. It held every period, and could never have done otherwise.

```
$ pnpm --filter @therecord/procedure redrun

  injecting fault: slot 26   escrowedFunds 480000000000 → 999999999999

  ─── RED — same procedure, corrupted escrow figure ───
    CLEAN      C1  Outflow destination allowlist
    CLEAN      C2  Control preconditions
    EXCEPTION  C3  Escrow backing
    CLEAN      C4  Liquid backing
    CLEAN      C5  Available-funds wedge

  the control fires. CLEAN → EXCEPTION on a single corrupted storage slot.
```

Coston2 forked, one slot overwritten, identical procedure rerun — the XRP Ledger left untouched and real. **Four controls correctly do not move**, because a check that fires on everything is as useless as one that never fires.

It **exits non-zero if C3 stays CLEAN**, and runs in CI, so a control that stops being able to fail **breaks the build**. The catalogue holds **9 faults** — each declaring what it must fire on *and* must not move — plus **3 we inject and publish that we do not catch**, because a suite that catches everything is measuring its own imagination.

---

## How much can a stranger check?

Not a safety rating. A different question: how much could *you* establish yourself.

| Tier | Means | Graded |
|---|---|---|
| **V0** ASSERTED | the system states facts about itself; you take its word | |
| **V1** OBSERVABLE | the facts are public, a stranger can read them | Flare TEE registry |
| **V2** RECONCILED | two independent sources agree, disagreement would show | |
| **V3** FALSIFIED | the check is proven able to fail, on the record, recently | FXRP core vault |

V3 exists because a reconciliation nobody has seen fail is indistinguishable from one that *cannot*. It **lapses after 30 days**. The tier can go down, ours included.

---

## How it uses Flare

| Primitive | How |
|---|---|
| **FDC** `ReferencedPaymentNonexistence` | Asks the Data Connector to prove a payment *did not* happen — then requires the verifier to **refuse** redemptions the chain already recorded as performed. That refusal test caught our own false accusation. |
| **FAssets / Core Vault** | Reconciles `escrowedFunds` against the vault's actual **XRPL Escrow objects** — two chains that cannot move each other. |
| **FAssets agents** | Resolves `getAgentInfo` through the **EIP-2535 diamond loupe** at run time; reconciles all six agents against their XRPL addresses. |
| **Contract Registry** | Nothing hardcoded but the registry. Resolved at run time, asset picked by the token's own symbol — a new FAsset is **discovered**, not missed. |
| **FlareTeeManager** | Enumerates every TEE machine and measures what its hash establishes. `doctor` live-probes them: **216 of 268 did not answer**. |
| **Reproducible builds** | Rebuilt **5 of Flare's own OCI images**, and fixed the published recipe when it didn't work. |

---

## Sent upstream to Flare

**[developer-hub#1455](https://github.com/flare-foundation/developer-hub/pull/1455)** — `RedemptionPerformed.requestId` documented as `uint64`, emitted as `uint256`. It's **indexed**, so the type is part of the topic hash: an indexer written faithfully from the docs matches **nothing**, and every redemption looks permanently open. We diffed all 25 documented events; this was the only mismatch.

**[fce-extension-scaffold#3](https://github.com/flare-foundation/fce-extension-scaffold/pull/3)** — The reproducible-build procedure **cannot be followed**: the clone step 404s, `-f Dockerfile` has no matching file, and the build can't resolve `local/tee-node-base` under the driver the doc itself requires.

Both found by using Flare's own docs as a third party and having them fail.

---

## Deployment

Reads **Flare Mainnet** (chain 14). Contracts on **Coston2**, which is also the fault laboratory.

| Contract | Address |
|---|---|
| AssuranceRegistry | `0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439` |
| ReproRegistry | `0x7EfCBb20DC125A8322FCF862C04AcF97b0c1f70B` |
| FailRecord | `0x5f623912D4dFA8d4d702cA77754a3517B4FA4c56` |

**CV-1 is concluded on chain** — subject the mainnet Core Vault manager `0x6c8d96dEfE4cbEE05FA969Fc0Ac436d94Fc21784`, opinion **CLEAN**, evidence digest `0x77377318`.

`lapse()` is **permissionless**: if a reporter goes silent, any stranger can write the adverse record. Suppression becomes the record.

---

## Everything we got wrong

**Eight errata. Four reached the public** before being withdrawn — including a claim that **93 redemption agents had defaulted when every one had paid**, in full and on time.

Each names the exact wrong value, the mechanism, how it was caught, and the test that now makes it unconstructable.

> Three of the eight are the same error in different clothes: a comparison between numbers never defined to be equal, or that could never disagree. That is the failure mode of assurance work, and it is invisible from the inside — every one produced confident, well-formatted output that was meaningless.

---

## Limitations

- **Zero real defaults exist on FXRP today**, so Covenant's failure path is exercised by fault injection, not live defaults. We say so rather than implying otherwise.
- **Covenant cannot be backfilled** — FDC proofs expire at `lutlimit` (~14 days). Stated, not quietly omitted.
- **Three faults are declared uncaught**, in `faults.json` as data, not a footnote.
- **No users yet.** Weeks old, no distribution history — the badge and API exist because that is the gap.

---

## Verify it yourself

```sh
git clone https://github.com/Pratiikpy/the-record && cd the-record && pnpm install

pnpm -r run test                                       # 544 tests (614 with Solidity)
pnpm --filter @therecord/procedure redrun              # the red run: CLEAN → EXCEPTION
pnpm --filter @therecord/procedure agents              # every FXRP agent vs the XRP Ledger
pnpm --filter @therecord/reprod provenance --registry  # the TEE measurement
pnpm --filter @therecord/procedure verify              # re-derive an opinion, network unplugged
pnpm --filter @therecord/reprod drift                  # is our snapshot still true of the chain?
```

**`verify`** is the one to run if you run one. It replaces `fetch` with a function that throws and rebuilds the opinion from recorded reads alone — the pack is either sufficient or rejected, never topped up from the network.

**`drift`** is the one that can embarrass us, which is why it ships. It **refused one of our own deploys** during this build when the TEE registry moved past the materiality threshold. We re-scanned rather than overriding. A gate that has never refused anything is not a gate.

---

**Roadmap** — coverage as the product (every agent and machine gets a citable record) → alerts → content-addressed permanence → a DSL so others can write controls → agents stake and a proven default slashes → FBTC/FDOGE on day one, already auto-discovered.

---

The hard part of assurance is not producing output. It is producing output that **could have come out differently**. That is why the red run exists, why it runs in CI, and why the top tier of our own scale requires it.

**Open the errata page first.** It is the part nobody else can copy, because copying it requires having been wrong in public.

---

**Full submission, requirement by requirement:**
https://comfortable-goal-205.notion.site/THE-RECORD-Flare-Summer-Signal-submission-3b39c0ce787681518236e914f2decc49
