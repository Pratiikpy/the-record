/**
 * The fault catalogue.
 *
 * A control that has only ever printed CLEAN is indistinguishable from one that
 * CANNOT print anything else. This project has already shipped exactly that
 * failure — an identity between two figures that both derived from the same
 * storage slot, green every period, incapable of ever being anything else.
 *
 * `redrun` proved one control can fail, once, for one fault. That is an
 * anecdote. This turns it into a suite: faults are data, not scripts, and each
 * one declares BOTH which controls must fire AND which must not move. The
 * second half matters as much as the first — a check that fires on everything
 * is no more informative than one that fires on nothing.
 *
 * ── WHAT FAULT INJECTION DOES NOT PROVE ────────────────────────────────────
 *
 * Injecting a fault shows a control is capable of firing for that fault class.
 * It says nothing about whether the control asserts the RIGHT invariant. Our
 * own retracted 93 defaults fired correctly — against a question that was
 * wrong. And it says nothing about faults nobody thought to put in the
 * catalogue, which is why the uncaught list is a published artifact rather
 * than a private TODO.
 */
import type { CoreVaultState, Opinion } from "./cv1.js";

export type FaultClass =
  /** overwrite a storage slot on a forked chain */
  | "chain-state"
  /** serve a well-formed but false answer from a data source */
  | "transport"
  /** no fault at all — proves the harness itself can fail */
  | "null";

export interface Fault {
  id: string;
  title: string;
  class: FaultClass;
  /** what a run of this fault establishes, in plain words */
  proves: string;
  /** what it explicitly does not — rendered beside it, always */
  doesNotProve: string;
  /** control ids that MUST report EXCEPTION under this fault */
  mustFire: string[];
  /**
   * Control ids that must NOT change opinion under this fault.
   *
   * Asserting the false-positive side is what turns "4 of 5 controls did not
   * move" from an observation into a test.
   */
  mustNotMove: string[];
  /**
   * Apply the fault to the evidence. Chain-state faults are applied by the
   * runner against a fork before this is reached; transport faults rewrite the
   * observed state here, which is why both classes share one signature.
   */
  apply: (s: CoreVaultState) => CoreVaultState;
}

const withLedger = (
  s: CoreVaultState,
  patch: Partial<NonNullable<CoreVaultState["onLedger"]>>,
): CoreVaultState => {
  if (!s.onLedger) return s;
  return { ...s, onLedger: { ...s.onLedger, ...patch } };
};

export const FAULTS: readonly Fault[] = [
  {
    id: "FAULT-00",
    title: "No fault at all",
    class: "null",
    proves: "that the harness fails loudly when nothing was actually broken",
    doesNotProve: "anything about the controls — this run exercises the guard, not the system",
    mustFire: [],
    mustNotMove: ["C1", "C2", "C3", "C4", "C5"],
    apply: (s) => s,
  },
  {
    id: "FAULT-01",
    title: "Flare over-reports escrowed funds",
    class: "chain-state",
    proves:
      "that C3 detects Flare accounting for escrow the XRP Ledger does not hold, using two sources " +
      "that cannot move each other",
    doesNotProve: "that C3 would catch a shortfall introduced on the XRPL side instead",
    mustFire: ["C3"],
    mustNotMove: ["C1", "C2", "C4", "C5"],
    apply: (s) => ({ ...s, escrowedFundsUBA: "999999999999" }),
  },
  {
    id: "FAULT-02",
    title: "Flare under-reports escrowed funds",
    class: "chain-state",
    proves: "that C3 is two-sided — unrecorded escrow is a breach, not a conservative rounding",
    doesNotProve: "that the direction of a real discrepancy could be inferred from the exception alone",
    mustFire: ["C3"],
    mustNotMove: ["C1", "C2", "C4", "C5"],
    apply: (s) => ({ ...s, escrowedFundsUBA: "1" }),
  },
  {
    id: "FAULT-03",
    title: "Flare claims more spendable XRP than the vault holds",
    class: "chain-state",
    proves: "that C4 detects a liquid shortfall after the ledger's own reserve",
    doesNotProve: "that a surplus is safe — C4 deliberately treats excess as an observation",
    mustFire: ["C4"],
    mustNotMove: ["C1", "C2", "C3", "C5"],
    apply: (s) =>
      s.onLedger
        ? { ...s, availableFundsUBA: (BigInt(s.onLedger.balanceDrops) + 1n).toString() }
        : s,
  },
  {
    id: "FAULT-04",
    title: "XRPL silently drops one escrow object",
    class: "transport",
    proves:
      "that C3 catches a data source that returns a well-formed, plausible, incomplete answer — " +
      "the failure mode that produces a confident wrong verdict rather than an error",
    doesNotProve: "that a dropped object would be noticed if Flare's figure were stale in the same direction",
    mustFire: ["C3"],
    mustNotMove: ["C1", "C2", "C5"],
    apply: (s) =>
      s.onLedger && s.onLedger.escrowCount > 0
        ? withLedger(s, {
            escrowCount: s.onLedger.escrowCount - 1,
            escrowedDrops: (
              BigInt(s.onLedger.escrowedDrops) -
              BigInt(s.onLedger.escrowedDrops) / BigInt(s.onLedger.escrowCount)
            ).toString(),
          })
        : s,
  },
  {
    id: "FAULT-05",
    title: "XRPL replays a stale balance",
    class: "transport",
    proves: "that C4 does not accept a balance that is plausible but too small to cover the claim",
    doesNotProve: "that a stale balance LARGER than the truth would be detected — it would not",
    mustFire: ["C4"],
    mustNotMove: ["C1", "C2", "C3", "C5"],
    apply: (s) => withLedger(s, { balanceDrops: "1000000" }),
  },
  {
    id: "FAULT-06",
    title: "XRPL is unreachable",
    class: "transport",
    proves:
      "that losing the independent source produces DISCLAIMER rather than CLEAN — the single " +
      "easiest way for an assurance product to become dishonest is to score missing evidence as a pass",
    doesNotProve: "that partial evidence is handled correctly; this is the total-loss case",
    mustFire: [],
    mustNotMove: ["C1", "C2", "C5"],
    apply: (s) => ({ ...s, onLedger: undefined }),
  },
  {
    id: "FAULT-07",
    title: "An escrow is denominated in something other than XRP",
    class: "transport",
    proves:
      "that an un-summable escrow disclaims instead of counting as zero, which would manufacture " +
      "a shortfall the moment a newer amendment ships",
    doesNotProve: "that the non-XRP amount could be reconciled — only that we refuse to guess it",
    mustFire: [],
    mustNotMove: ["C1", "C2", "C4", "C5"],
    apply: (s) => withLedger(s, { nonXrpEscrows: 1 }),
  },
  {
    id: "FAULT-08",
    title: "The destination allowlist is emptied",
    class: "chain-state",
    proves: "that C2 catches a precondition failure that would make C1 pass vacuously",
    doesNotProve: "that C1 itself is correct — only that its preconditions are checked",
    mustFire: ["C2"],
    mustNotMove: ["C3", "C4", "C5"],
    apply: (s) => ({ ...s, allowedDestinations: [] }),
  },
] as const;

export interface FaultOutcome {
  fault: Fault;
  /** control id → opinion, before and after */
  before: Record<string, Opinion>;
  after: Record<string, Opinion>;
  firedAsRequired: boolean;
  movedWhenItShouldNot: string[];
  missingFires: string[];
  pass: boolean;
}

/**
 * Score one fault against a before/after pair.
 *
 * Both halves are hard requirements. A fault that fires the right control but
 * also disturbs an unrelated one has revealed a false-positive path, and that
 * is a failure of the suite even though the headline control "worked".
 */
export function scoreFault(
  fault: Fault,
  before: Record<string, Opinion>,
  after: Record<string, Opinion>,
): FaultOutcome {
  const missingFires = fault.mustFire.filter((id) => after[id] !== "EXCEPTION");
  const movedWhenItShouldNot = fault.mustNotMove.filter(
    (id) => before[id] !== undefined && after[id] !== undefined && before[id] !== after[id],
  );
  return {
    fault,
    before,
    after,
    firedAsRequired: missingFires.length === 0,
    movedWhenItShouldNot,
    missingFires,
    pass: missingFires.length === 0 && movedWhenItShouldNot.length === 0,
  };
}

/**
 * Adjudicate a candidate exception against its cross-chain skew bracket.
 *
 * Lives here, exported and pure, for a reason. It began as inline logic in the
 * backfill runner, where it could not be tested — and across 119 sampled
 * heights it suppressed exactly nothing. A safeguard that has never fired is
 * indistinguishable from one that cannot, which is the identical disease this
 * package exists to treat, one level up the stack. So the decision is a
 * function with its own tests, and its zero-suppression record on real data is
 * a measured result rather than an untested assumption.
 *
 * `neighbourFired` holds, for each bracket height that could be read, whether
 * the same control still breached there. An exception is only confirmed if
 * every readable neighbour agrees. If the bracket disagrees, the honest
 * conclusion is not "the vault was short" but "we cannot tell from two chains
 * sampled seconds apart" — a DISCLAIMER, not an EXCEPTION.
 */
export function adjudicateSkew(
  exceptional: readonly string[],
  neighbourFired: readonly boolean[],
): { confirmed: boolean; reason?: string } {
  if (exceptional.length === 0) return { confirmed: false, reason: "no candidate exception to adjudicate" };
  if (neighbourFired.length === 0) {
    // No neighbour was readable. The candidate is unadjudicated, and publishing
    // an unadjudicated exception is exactly the false accusation to avoid.
    return { confirmed: false, reason: "no bracket height could be read, so the candidate is unadjudicated" };
  }
  if (neighbourFired.every(Boolean)) return { confirmed: true };
  return {
    confirmed: false,
    reason: `breached at the paired height but not across the bracket (${neighbourFired.filter(Boolean).length}/${neighbourFired.length} agreed) — unresolvable cross-chain skew`,
  };
}

/**
 * Faults we have injected and NOT caught.
 *
 * Published deliberately and kept in source, because the catalogue is
 * self-graded and a suite that only contains faults we already pass measures
 * our imagination rather than the system. This list may only grow by our own
 * hand, which is exactly why it is worth reading.
 */
export const KNOWN_UNCAUGHT: ReadonlyArray<{ title: string; why: string }> = [
  {
    title: "XRPL reports a balance LARGER than the truth",
    why:
      "C4 only breaches when the claim exceeds spendable, so an inflated balance makes the vault " +
      "look healthier and is not detected. Catching it needs a third source we do not have.",
  },
  {
    title: "Flare and XRPL are BOTH wrong in the same direction",
    why:
      "A cross-source reconciliation cannot detect a discrepancy that does not exist between its " +
      "two sources. This is the structural limit of the method, not an implementation gap.",
  },
  {
    title: "A control asserts the wrong invariant entirely",
    why:
      "Fault injection proves a control CAN fire, never that it is asking the right question. Our " +
      "own 93 retracted defaults fired correctly against a request that asked for the wrong amount.",
  },
];
