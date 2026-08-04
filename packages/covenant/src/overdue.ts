/**
 * overdue — obligations past their deadline with no resolution recorded.
 *
 * Coston2 has zero `RedemptionDefault` events, and the first reading of that is
 * "nothing ever fails". The second reading is the correct one: **a default does
 * not record itself.** `redemptionPaymentDefault` has to be CALLED, by the
 * redeemer, the agent, or a pre-appointed executor. If nobody calls it, the
 * obligation simply sits unresolved and the chain stays silent.
 *
 * So the absence of defaults is not evidence of settlement. It is the gap.
 *
 * ⚠ THE LINE THIS MODULE MUST NOT CROSS.
 * "No terminal event on Flare" is NOT "the agent did not pay". An agent may
 * well have paid on XRPL and never submitted the proof that records
 * `RedemptionPerformed`. Only an FDC attestation settles which happened. This
 * module therefore reports OBLIGATIONS UNRESOLVED, never defaults, and never
 * names an agent as having failed. Determining which is exactly the job of the
 * executor service — and exactly why it needs to exist.
 */
export const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * FDC proofs of a missed payment can only be minted for ~14 days after the
 * deadline (`lutlimit` 0x127500 = 1,209,600s). After that the question becomes
 * permanently unanswerable — the record's completeness is a running clock, not
 * a backlog that can be caught up on later.
 */
export const FDC_PROOF_WINDOW_SECONDS = 1_209_600;

export type Status =
  /** deadline passed, proof window open, and a guardian was named up front */
  | "RESOLVABLE_BY_EXECUTOR"
  /** deadline passed, proof window open, but only the redeemer or agent may act */
  | "RESOLVABLE_BY_PARTY"
  /** proof window closed — whether it was paid can never now be established */
  | "UNRESOLVABLE"
  /** not yet due */
  | "PENDING";

export interface Obligation {
  requestId: string;
  agentVault: string;
  redeemer: string;
  valueUBA: string;
  executor: string;
  /** unix seconds — verified to be a real wall-clock time, not a chain epoch */
  lastUnderlyingTimestamp: string;
}

export function statusOf(o: Obligation, nowSeconds: number): Status {
  const deadline = Number(o.lastUnderlyingTimestamp);
  if (!Number.isFinite(deadline) || deadline <= 0) return "PENDING";
  if (nowSeconds <= deadline) return "PENDING";
  if (nowSeconds > deadline + FDC_PROOF_WINDOW_SECONDS) return "UNRESOLVABLE";
  return o.executor.toLowerCase() !== ZERO ? "RESOLVABLE_BY_EXECUTOR" : "RESOLVABLE_BY_PARTY";
}

/** Seconds of proof window left. Negative once the window has closed. */
export function windowRemaining(o: Obligation, nowSeconds: number): number {
  return Number(o.lastUnderlyingTimestamp) + FDC_PROOF_WINDOW_SECONDS - nowSeconds;
}

export interface OverdueRow extends Obligation {
  status: Status;
  overdueSeconds: number;
  windowRemainingSeconds: number;
}

export interface OverdueReport {
  generatedAt: string;
  now: number;
  /** carried into every rendering of this data */
  caveat: string;
  totals: {
    examined: number;
    resolvableByExecutor: number;
    resolvableByParty: number;
    unresolvable: number;
    pending: number;
    valueUnresolvedUBA: string;
    /** the soonest proof window to close, in seconds */
    soonestWindowClose: number | null;
  };
  rows: OverdueRow[];
}

export const CAVEAT =
  "Unresolved on Flare is not the same as unpaid. An agent may have paid on XRPL without submitting the proof that records RedemptionPerformed; only an FDC attestation settles which happened. No agent is named here as having failed.";

export function buildReport(obligations: readonly Obligation[], nowSeconds: number): OverdueReport {
  const rows: OverdueRow[] = obligations.map((o) => ({
    ...o,
    status: statusOf(o, nowSeconds),
    overdueSeconds: Math.max(0, nowSeconds - Number(o.lastUnderlyingTimestamp)),
    windowRemainingSeconds: windowRemaining(o, nowSeconds),
  }));

  const count = (s: Status): number => rows.filter((r) => r.status === s).length;
  const unresolved = rows.filter((r) => r.status !== "PENDING");
  const open = rows.filter(
    (r) => r.status === "RESOLVABLE_BY_EXECUTOR" || r.status === "RESOLVABLE_BY_PARTY",
  );

  rows.sort((a, b) => a.windowRemainingSeconds - b.windowRemainingSeconds);

  return {
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    now: nowSeconds,
    caveat: CAVEAT,
    totals: {
      examined: rows.length,
      resolvableByExecutor: count("RESOLVABLE_BY_EXECUTOR"),
      resolvableByParty: count("RESOLVABLE_BY_PARTY"),
      unresolvable: count("UNRESOLVABLE"),
      pending: count("PENDING"),
      valueUnresolvedUBA: unresolved.reduce((s, r) => s + BigInt(r.valueUBA), 0n).toString(),
      soonestWindowClose:
        open.length > 0 ? Math.min(...open.map((r) => r.windowRemainingSeconds)) : null,
    },
    rows,
  };
}
