/**
 * AB-1 — is every FXRP agent's minted supply actually backed on the XRP Ledger?
 *
 * CV-1 reconciles the Core Vault. Nobody reconciles the agents, and the agents
 * are where a redemption is actually paid from. So this asks the same question
 * one level down: for each agent, does the XRP Ledger hold what Flare says it
 * holds?
 *
 * ── WHY THIS CONTROL IS DANGEROUS ─────────────────────────────────────────
 *
 * The naive version of this check accuses honest agents of insolvency, on
 * mainnet, with real money. We measured it happening.
 *
 * An agent pays a redemption on the XRP Ledger FIRST. Flare's
 * `underlyingBalanceUBA` only falls once that payment is confirmed back on
 * Flare, which lags by up to a few minutes. Read the two chains at a single
 * instant inside that window and the agent looks short by exactly the size of
 * the in-flight payment:
 *
 *     t1  flare 408,410.89 | xrpl 394,344.37 | -14,066.52   <- false shortfall
 *     t2  flare 393,423.10 | xrpl 394,344.37 |    +921.27   <- truth, 45s later
 *
 * The drop on Flare between t1 and t2 was 14,987.78 UBA, matching to the drop
 * the XRP Ledger payment at ledger 106,099,993 exactly. That equality is what
 * makes it a timing artifact rather than a coincidence.
 *
 * So a shortfall is never published from a single observation. It is a
 * CANDIDATE, re-read across a settle bracket, and only confirmed if it survives
 * every reading. Anything that resolves is a DISCLAIMER naming the skew —
 * because "we could not distinguish this from settlement lag" is what we
 * actually know, and E-001 is what happens when we say more than that.
 */

/** UBA and XRPL drops are both 1e-6 XRP, so they compare directly. */
export type UBA = bigint;

export interface AgentReading {
  /** what Flare's AssetManager records as the agent's underlying balance */
  flareUnderlyingUBA: UBA;
  /** balance + escrowed objects at the agent's underlying XRPL address */
  onLedgerUBA: UBA | null;
  flareBlock: bigint;
  xrplLedger: number | null;
}

export type AgentOpinion = "CLEAN" | "EXCEPTION" | "DISCLAIMER";

export interface AgentVerdict {
  opinion: AgentOpinion;
  /** ledger − flare. Negative means the ledger holds less than Flare claims. */
  differenceUBA: UBA | null;
  because: string;
}

/**
 * A single reading can only ever produce CLEAN or a CANDIDATE — never an
 * accusation. Kept separate from the bracket so the distinction is structural
 * rather than a matter of remembering to call the right function.
 */
export function classifyReading(r: AgentReading): "BACKED" | "CANDIDATE" | "UNREADABLE" {
  if (r.onLedgerUBA === null) return "UNREADABLE";
  return r.onLedgerUBA >= r.flareUnderlyingUBA ? "BACKED" : "CANDIDATE";
}

/**
 * Adjudicate a candidate shortfall across a settle bracket.
 *
 * `readings` are successive observations of the same agent, oldest first. A
 * shortfall is confirmed only if EVERY reading is short. One backed reading
 * anywhere in the bracket means settlement caught up, which is the difference
 * between a finding and a libel.
 */
export function adjudicateBacking(readings: readonly AgentReading[]): AgentVerdict {
  if (readings.length === 0) {
    return { opinion: "DISCLAIMER", differenceUBA: null, because: "no reading was taken" };
  }

  const classes = readings.map(classifyReading);
  const last = readings[readings.length - 1]!;
  const diff = last.onLedgerUBA === null ? null : last.onLedgerUBA - last.flareUnderlyingUBA;

  // Not being able to read is never evidence of backing, and never evidence of
  // its absence. Same discipline as a DISCLAIMER never rolling up as a pass.
  if (classes.every((c) => c === "UNREADABLE")) {
    return {
      opinion: "DISCLAIMER",
      differenceUBA: null,
      because: "the agent's underlying address could not be read at any height in the bracket",
    };
  }

  if (classes.every((c) => c === "BACKED")) {
    return {
      opinion: "CLEAN",
      differenceUBA: diff,
      because:
        diff !== null && diff > 0n
          ? `the XRP Ledger holds ${diff} UBA more than Flare records, at every height in the bracket`
          : "the XRP Ledger holds exactly what Flare records, at every height in the bracket",
    };
  }

  const shortAll = classes.every((c) => c === "CANDIDATE");
  if (shortAll && readings.length >= 2) {
    return {
      opinion: "EXCEPTION",
      differenceUBA: diff,
      because:
        `the XRP Ledger held less than Flare records at all ${readings.length} heights in the settle ` +
        `bracket, so this is not settlement lag`,
    };
  }

  if (shortAll) {
    // A single short reading is exactly the observation that produced the
    // false 14,066 XRP accusation. One sample is not a bracket.
    return {
      opinion: "DISCLAIMER",
      differenceUBA: diff,
      because:
        "only one reading was taken, and a single cross-chain observation cannot distinguish a " +
        "shortfall from an in-flight redemption",
    };
  }

  return {
    opinion: "DISCLAIMER",
    differenceUBA: diff,
    because:
      "the shortfall did not persist across the settle bracket, which is the signature of a " +
      "redemption paid on the XRP Ledger before Flare recorded it",
  };
}

/** Roll a fleet up. An EXCEPTION anywhere dominates; a DISCLAIMER never becomes a pass. */
export function rollUpFleet(verdicts: readonly AgentVerdict[]): AgentOpinion {
  if (verdicts.length === 0) return "DISCLAIMER";
  if (verdicts.some((v) => v.opinion === "EXCEPTION")) return "EXCEPTION";
  if (verdicts.some((v) => v.opinion === "DISCLAIMER")) return "DISCLAIMER";
  return "CLEAN";
}
