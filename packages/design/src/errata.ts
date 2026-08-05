/**
 * The errata.
 *
 * Every register here makes claims about somebody else's system. The only
 * thing that makes that defensible is a public, permanent account of the times
 * we got it wrong — kept with the same care as the findings, and never quietly
 * edited away.
 *
 * This is not humility theatre. A retraction is the single cheapest thing to
 * fake and the single hardest thing to fake *specifically*: an entry here names
 * the exact wrong value, the exact mechanism, and what now makes it
 * unconstructable. That is checkable. "We take accuracy seriously" is not.
 *
 * ── RULES FOR THIS FILE ────────────────────────────────────────────────────
 *
 * 1. Entries are append-only. A superseded claim is struck through, never
 *    deleted, because a corrections page you can edit is not a corrections page.
 * 2. Every entry states how it was CAUGHT. An error found by our own control
 *    and an error found by a stranger are different evidence about the system.
 * 3. Every entry states what stops it recurring, and that thing is a test, not
 *    an intention.
 * 4. Published errors and caught-before-publication errors are marked
 *    differently and never blurred together. We are not owed credit for the
 *    ones that never reached anyone.
 */

export type Fate =
  /** it reached the public and had to be withdrawn */
  | "PUBLISHED"
  /** caught before anyone saw it — disclosed anyway, but not the same thing */
  | "CAUGHT_BEFORE_PUBLICATION";

export interface Erratum {
  id: string;
  date: string;
  fate: Fate;
  /** the claim, as it was made */
  claimed: string;
  /** what was actually true */
  truth: string;
  /** the mechanism of the error, precisely enough to be checked */
  mechanism: string;
  /** what surfaced it */
  caughtBy: string;
  /** the test or type that now makes it unconstructable */
  preventedBy: string;
}

export const ERRATA: readonly Erratum[] = [
  {
    id: "E-001",
    date: "2026-08-04",
    fate: "PUBLISHED",
    claimed: "93 FXRP redemptions were proven defaults — agents that took a fee and never delivered XRP.",
    truth: "Zero of them were defaults. All 91 agents examined had paid, in full, on time.",
    mechanism:
      "The FDC request asked whether a payment of valueUBA existed. An agent owes valueUBA − feeUBA. " +
      "The amount we asked about had never existed, so the oracle truthfully attested its absence for " +
      "every redemption. The attestation was correct; the question was wrong.",
    caughtBy:
      "A control test that required the verifier to REFUSE redemptions the chain already recorded as " +
      "performed. It refused none of them, which meant the request could not distinguish paid from unpaid.",
    preventedBy:
      "amountOwed() is now the single place the obligation is computed, verified against settled " +
      "redemption 43128188 whose real XRPL payment delivered exactly valueUBA − feeUBA.",
  },
  {
    id: "E-002",
    date: "2026-08-04",
    fate: "PUBLISHED",
    claimed:
      "Control C3 reported a 400 UBA exception against Flare, asserting availableFunds + escrowedFunds ≤ totalAvailableUBA.",
    truth: "Those figures were never defined to relate. The 400 UBA is a fee the asset manager nets off.",
    mechanism:
      "Two numbers from two contracts were compared because they looked comparable. Nothing in the " +
      "protocol says they should be equal, so the difference was not a finding.",
    caughtBy: "Reading the asset manager's own accounting after the exception was published.",
    preventedBy:
      "The wedge is now disclosed as an observation (C5) rather than judged, and the regression is pinned " +
      "by a test asserting the exact 400 UBA gap is expected.",
  },
  {
    id: "E-003",
    date: "2026-08-04",
    fate: "PUBLISHED",
    claimed:
      "Control C3 asserted escrowedFunds = totalAvailable − immediatelyAvailable, and reported CLEAN every period.",
    truth: "The control could not fail. It had been printing CLEAN for reasons unrelated to the vault's health.",
    mechanism:
      "coreVaultAvailableAmount() derives both of its outputs from the same escrowedFunds storage slot. " +
      "Corrupting that slot from 500,000,000,000 to 999,999,999,999 moved both sides of the identity " +
      "together and the control stayed green — a tautology wearing the costume of a reconciliation.",
    caughtBy: "Deliberate fault injection on a forked chain. Nothing else would have surfaced it.",
    preventedBy:
      "C3 now reconciles Flare's escrowedFunds against XRPL Escrow objects — two chains that cannot move " +
      "each other — and the red run fails the build if C3 survives its own fault.",
  },
  {
    id: "E-004",
    date: "2026-08-04",
    fate: "CAUGHT_BEFORE_PUBLICATION",
    claimed:
      "A draft of C3 asserted availableFunds + escrowedFunds ≤ account balance, producing a 497,844,875,522 drop shortfall against Flare.",
    truth: "There was no shortfall. The arithmetic double-counted every escrow.",
    mechanism:
      "XRPL escrow REMOVES XRP from account_data.Balance and holds it in Escrow ledger objects. Adding " +
      "Flare's escrowed figure to a balance that already excludes it counts the same XRP twice.",
    caughtBy: "Checking the live XRPL account objects before publishing the exception.",
    preventedBy:
      "A regression test asserts the exact bad arithmetic still produces 497,844,875,522 and that the " +
      "current control reports CLEAN on the same data.",
  },
  {
    id: "E-005",
    date: "2026-08-05",
    fate: "CAUGHT_BEFORE_PUBLICATION",
    claimed: "The status badge reported a verdict as fresh.",
    truth:
      "The badge could never go stale. Its computed age was −21 hours, because freshness was derived from " +
      "the day under test rather than when the report ran.",
    mechanism:
      "CV-1 recorded a period, not a timestamp. Anchoring the period to end-of-day dated every report into " +
      "the future, and a negative age passed the freshness budget trivially.",
    caughtBy: "Reading the emitted JSON instead of trusting that the badge rendered.",
    preventedBy:
      "CV-1 records generatedAt, and a future-dated report renders UNKNOWN rather than vouching indefinitely.",
  },
  {
    id: "E-006",
    date: "2026-08-05",
    fate: "CAUGHT_BEFORE_PUBLICATION",
    claimed: "The red run forked Coston2 and reconciled it against the Coston2 XRPL testnet vault.",
    truth:
      "It would have reconciled a Coston2 fork against the REAL XRP Ledger — two unrelated systems, " +
      "compared with complete confidence. The controls would have 'fired' and proven nothing.",
    mechanism:
      "xrpl.ts chose its XRPL cluster at module load. ESM hoists imports above the importing module's " +
      "statements, so the red run setting NETWORK at the top of its own file ran too late.",
    caughtBy:
      "Grading the subjects, which forced the question of what evidence V3 actually rests on. The hoisting " +
      "behaviour was then reproduced in a five-line test rather than assumed.",
    preventedBy: "Endpoints resolve per call, so the caller's network selection is honoured.",
  },
  {
    id: "E-007",
    date: "2026-08-05",
    fate: "CAUGHT_BEFORE_PUBLICATION",
    claimed:
      "Evidence packs were anchored to a Flare block, an XRPL ledger and a cross-chain skew of 0 seconds.",
    truth:
      "None of the three anchors described the state in the pack. The block was read AFTER the contract " +
      "reads, so it named a later height. The XRPL ledger was the newest of the last 200 transactions, " +
      "not the ledger the balance and escrows were read at. The skew was hardcoded, never measured.",
    mechanism:
      "Each anchor was taken from whatever value was conveniently to hand rather than from the read " +
      "itself. A replayer at the stated Flare block could legitimately compute a different opinion, and " +
      "the stated XRPL ledger was simply unrelated to the balances beside it.",
    caughtBy:
      "Writing a regression test that asserted the anchor equals the height the state was read at. The " +
      "first version of that test failed twice, and the second failure exposed a deeper form of the same " +
      "bug: the recorded XRPL evidence did not carry its own ledger, so a replayer could not confirm the " +
      "anchor from the pack at all.",
    preventedBy:
      "Reads are pinned to a block number obtained first; accountLedgerState returns the ledger and close " +
      "time it used; skew is computed from them and reports -1 when it cannot be established. The pack is " +
      "self-describing, and tests assert the anchor matches the recorded evidence.",
  },
] as const;

export interface ErrataSummary {
  total: number;
  published: number;
  caughtBeforePublication: number;
  /** how many were surfaced by our own machinery rather than by reading */
  caughtByOwnControls: number;
}

export function summariseErrata(errata: readonly Erratum[] = ERRATA): ErrataSummary {
  return {
    total: errata.length,
    published: errata.filter((e) => e.fate === "PUBLISHED").length,
    caughtBeforePublication: errata.filter((e) => e.fate === "CAUGHT_BEFORE_PUBLICATION").length,
    caughtByOwnControls: errata.filter((e) => /control test|fault injection|red run/iu.test(e.caughtBy)).length,
  };
}
