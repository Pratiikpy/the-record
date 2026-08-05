# Three small specifications

**A check nobody has seen fail is indistinguishable from a check that cannot fail.**

That sentence is the whole of it. These formats exist so the sentence becomes
enforceable by a program rather than promised in a README.

They are deliberately tiny, deliberately boring, and deliberately not ours. THE
RECORD is the first implementation, not the owner. If you adopt them and never
mention us, they have worked.

| Spec | Answers | Status |
|---|---|---|
| [`faults.json`](#1-faultsjson--declaring-what-a-check-must-catch) | can this check fail at all? | implemented |
| [`V0–V3`](#2-v0v3--how-much-can-a-stranger-check) | how much can an outsider verify? | implemented |
| [`pack/v1`](#3-packv1--evidence-that-outlives-its-endpoint) | can this finding be re-derived in ten years? | implemented |

---

## 1 · `faults.json` — declaring what a check must catch

### The problem

We shipped a control that asserted `escrowedFunds = totalAvailable − immediatelyAvailable`.

It held exactly. Every period. Green, forever — because
`coreVaultAvailableAmount()` derives **both** of its outputs from that same
storage slot. Corrupting the slot moved both sides of the identity together and
the control stayed CLEAN.

It was a tautology wearing the costume of a reconciliation, and nothing except a
deliberate fault would ever have revealed it. Not code review, not tests, not a
year of green dashboards.

### The format

A fault declares what it breaks, what **must** fire, and — the part everyone
forgets — what must **not** move.

```json
{
  "schema": "therecord.faults/v1",
  "faults": [
    {
      "id": "FAULT-01",
      "title": "Flare over-reports escrowed funds",
      "class": "chain-state",
      "proves": "that C3 detects Flare accounting for escrow the XRP Ledger does not hold",
      "doesNotProve": "that C3 would catch a shortfall introduced on the XRPL side instead",
      "mustFire": ["C3"],
      "mustNotMove": ["C1", "C2", "C4", "C5"]
    }
  ],
  "knownUncaught": [
    {
      "title": "XRPL reports a balance LARGER than the truth",
      "why": "C4 only breaches when the claim exceeds spendable, so an inflated balance makes the vault look healthier and is not detected. Catching it needs a third source we do not have."
    }
  ]
}
```

### The three rules

**`mustNotMove` is mandatory.** A check that fires on everything is no more
informative than one that fires on nothing. A fault that only declares
`mustFire` has tested half the property, and the untested half is where false
positives live. A spec without it is invalid.

**`doesNotProve` is mandatory.** Fault injection shows a check is *capable* of
firing for one fault class. It says nothing about whether the check asserts the
**right** invariant. Our own retracted finding fired correctly — against a
question that was wrong.

**`knownUncaught` must be non-empty, or you are measuring your imagination.** A
suite that catches every fault it contains has told you about the author, not
the system. Publishing what you inject and miss is the only evidence the list
was ever adversarial.

### Classes

| Class | Means |
|---|---|
| `chain-state` | corrupt a storage slot on a fork |
| `transport` | a data source returns a well-formed, plausible, **false** answer |
| `null` | inject nothing — proves the harness itself can fail |

`null` is not a joke. A harness that reports success on a no-op fault is
decorative, and you cannot tell from the outside. Ours is `FAULT-00`, and
setting the injected value equal to the true value makes the run exit non-zero.

The `transport` class is the one most suites lack entirely. A replayed stale
balance, a silently dropped array element, a 200 with truncated JSON — these
produce a *confident wrong verdict* rather than an error, which is strictly
worse than an outage.

---

## 2 · `V0–V3` — how much can a stranger check?

Not a safety rating. It says nothing about whether a system is solvent, secure
or well run. It measures one thing: **how much of it an outsider can establish
without permission.**

| Tier | Name | Means |
|---|---|---|
| **V0** | `ASSERTED` | the system states facts about itself; you take its word |
| **V1** | `OBSERVABLE` | the facts are public, a stranger can read them |
| **V2** | `RECONCILED` | two independent sources agree, and a disagreement would be detected |
| **V3** | `FALSIFIED` | the check is proven able to fail — a fault was injected and it fired |

### Rules that make it mean something

**Cumulative.** A gap at V1 caps a subject at V0 however good its V3 story is. A
falsification test over facts nobody can read establishes nothing.

**Unevaluable counts as not met.** Never as passed. If a criterion cannot be
checked, the tier does not get the benefit of the doubt.

**V3 lapses.** After 30 days without a falsification, V3 decays to V2. A
falsification from six months ago says nothing about the code running today. The
tier can go **down**, including ours — that is the point, not a flaw.

**Independence is about sources, not counts.** Two figures from one contract are
one source. Our tautology sat comfortably at "V2" until we asked whether a
disagreement was *possible*.

### Why V3 exists

V2 is where most good monitoring stops, and V2 is exactly where a control that
can never fail lives comfortably — reconciling two numbers that were never
capable of disagreeing. V3 is the only tier that requires evidence *about the
check itself* rather than about the system.

---

## 3 · `pack/v1` — evidence that outlives its endpoint

A finding whose evidence depends on a live endpoint is a claim with an expiry
date. When the RPC prunes, rotates or dies, nobody can ever check it again.

A pack freezes the exact bytes a procedure consumed, at pinned heights, so the
verdict can be re-derived offline — in ten years, on a plane, from a USB stick,
with the author gone.

```json
{
  "schema": "therecord.pack/v1",
  "procedureId": "CV-1",
  "network": { "name": "flare", "chainId": 14 },
  "anchors": { "flareBlock": 66699979, "xrplLedger": 106085499, "skewSeconds": 0 },
  "reads": [
    { "method": "flare.escrowedFunds", "params": "{\"at\":\"0x6c8d…\"}", "result": "140000000000000" }
  ]
}
```

Addressed by `sha256` over its canonical serialisation.

### Canonicalisation rules

These are not style preferences. Each one exists because violating it makes two
honest parties disagree about nothing.

1. **Keys sorted recursively.** Insertion order is an artifact of how the code
   was written.
2. **No insignificant whitespace.**
3. **Integers as decimal strings.** A JSON number cannot hold a `uint256`.
4. **Reads sorted by `(method, params)`.** `Promise.all` resolves in arbitrary
   order; call order would make two honest runners produce different hashes from
   identical chain state.
5. **No timestamps or hostnames inside the hashed region.** Capture time is
   metadata and lives in the envelope. Otherwise the same evidence captured
   twice is two different packs and nothing can ever be compared.

### The rule that matters most

**A missing read must throw, never default.**

A verifier that proceeds with absent evidence produces a confident opinion about
facts it never saw. That is the failure this format exists to prevent, so it
must be loud.

### Verifying is not the same as agreeing

Replaying a pack tests **execution**, never the **assertion**. If the question
was wrong, every honest replayer on earth re-derives the identical wrong answer
and agrees unanimously.

Our own worst error proves it: we published that 93 redemption agents had
defaulted when every one had paid. That was not an evidence error or a compute
error — it was the wrong question, and perfect replication would have confirmed
it forever.

So: **agreement between replayers is an execution-integrity signal, not a truth
signal.** Anyone reporting a corroboration count must label it as such. The only
thing that catches a wrong question is an independently *written* check over the
same evidence.

---

## Adopting these

Nothing here requires our code, our register, our permission or our existence.

```
faults.json    write one for your monitor; make sure knownUncaught is not empty
V0–V3          state your tier and what would raise it
pack/v1        freeze your evidence; make your verifier pure
```

The reference implementation is [THE RECORD](https://the-record.vercel.app) —
[`faults.ts`](packages/procedure/src/faults.ts),
[`grade.ts`](packages/design/src/grade.ts),
[`pack.ts`](packages/procedure/src/pack.ts).

If these formats are wrong, they should be corrected in public and the
correction should be dated. That is how [our errata
page](https://the-record.vercel.app/errata) works, and it is the only reason to
believe anything else on it.

MIT. Take it.
