import { describe, it, expect } from "vitest";
import {
  statusOf,
  windowRemaining,
  buildReport,
  FDC_PROOF_WINDOW_SECONDS,
  ZERO,
  CAVEAT,
  type Obligation,
} from "../src/overdue.js";

/** A real unresolved obligation from Coston2, request 41934742. */
const REAL: Obligation = {
  requestId: "41934742",
  agentVault: "0x165c62b4531D28E34c68a8b2aCBF4D0421e4E028",
  redeemer: "0x0000000000000000000000000000000000001111",
  valueUBA: "10000000",
  executor: "0x0000000000000000000000000000000000002222",
  lastUnderlyingTimestamp: "1785362406", // 2026-07-29T22:00:06Z
};

const DEADLINE = Number(REAL.lastUnderlyingTimestamp);

describe("statusOf", () => {
  it("is PENDING before the deadline", () => {
    expect(statusOf(REAL, DEADLINE - 1)).toBe("PENDING");
    expect(statusOf(REAL, DEADLINE)).toBe("PENDING");
  });

  it("becomes resolvable the second after the deadline", () => {
    expect(statusOf(REAL, DEADLINE + 1)).toBe("RESOLVABLE_BY_EXECUTOR");
  });

  it("routes to the party when no executor was named", () => {
    expect(statusOf({ ...REAL, executor: ZERO }, DEADLINE + 1)).toBe("RESOLVABLE_BY_PARTY");
  });

  it("treats a zero-address executor case-insensitively", () => {
    const upper = ZERO.toUpperCase().replace("0X", "0x");
    expect(statusOf({ ...REAL, executor: upper }, DEADLINE + 1)).toBe("RESOLVABLE_BY_PARTY");
  });

  it("becomes UNRESOLVABLE once the FDC proof window closes", () => {
    expect(statusOf(REAL, DEADLINE + FDC_PROOF_WINDOW_SECONDS)).toBe("RESOLVABLE_BY_EXECUTOR");
    expect(statusOf(REAL, DEADLINE + FDC_PROOF_WINDOW_SECONDS + 1)).toBe("UNRESOLVABLE");
  });

  it("the window is exactly 14 days", () => {
    expect(FDC_PROOF_WINDOW_SECONDS).toBe(14 * 24 * 60 * 60);
  });

  it("degrades to PENDING on a malformed deadline rather than claiming overdue", () => {
    // Asserting "overdue" from a garbage timestamp would be the worst possible
    // failure here — it names an obligation as unresolved on bad data.
    expect(statusOf({ ...REAL, lastUnderlyingTimestamp: "0" }, DEADLINE + 1)).toBe("PENDING");
    expect(statusOf({ ...REAL, lastUnderlyingTimestamp: "not-a-number" }, DEADLINE + 1)).toBe(
      "PENDING",
    );
  });
});

describe("windowRemaining", () => {
  it("counts down and goes negative after the window closes", () => {
    expect(windowRemaining(REAL, DEADLINE)).toBe(FDC_PROOF_WINDOW_SECONDS);
    expect(windowRemaining(REAL, DEADLINE + FDC_PROOF_WINDOW_SECONDS)).toBe(0);
    expect(windowRemaining(REAL, DEADLINE + FDC_PROOF_WINDOW_SECONDS + 100)).toBe(-100);
  });
});

describe("buildReport", () => {
  const now = DEADLINE + 5 * 86_400; // five days past deadline

  it("counts each status and totals only unresolved value", () => {
    const r = buildReport(
      [
        REAL,
        { ...REAL, requestId: "2", executor: ZERO },
        { ...REAL, requestId: "3", lastUnderlyingTimestamp: String(now + 86_400) }, // pending
      ],
      now,
    );
    expect(r.totals.examined).toBe(3);
    expect(r.totals.resolvableByExecutor).toBe(1);
    expect(r.totals.resolvableByParty).toBe(1);
    expect(r.totals.pending).toBe(1);
    // the pending obligation's value is NOT at stake
    expect(r.totals.valueUnresolvedUBA).toBe("20000000");
  });

  it("sorts by urgency — the soonest window to close comes first", () => {
    const soon = { ...REAL, requestId: "soon", lastUnderlyingTimestamp: String(DEADLINE - 86_400) };
    const later = { ...REAL, requestId: "later", lastUnderlyingTimestamp: String(DEADLINE + 86_400) };
    const r = buildReport([later, soon], now);
    expect(r.rows[0]!.requestId).toBe("soon");
  });

  it("reports the soonest window close across resolvable rows only", () => {
    const r = buildReport([REAL], now);
    expect(r.totals.soonestWindowClose).toBe(FDC_PROOF_WINDOW_SECONDS - 5 * 86_400);
  });

  it("returns null for soonest close when nothing is resolvable", () => {
    const r = buildReport([{ ...REAL, lastUnderlyingTimestamp: String(now + 999) }], now);
    expect(r.totals.soonestWindowClose).toBeNull();
  });

  it("carries the caveat into the report itself, not just the docs", () => {
    // The single most dangerous misreading of this data is "unresolved means
    // the agent stole it". The disclaimer travels with the data.
    const r = buildReport([REAL], now);
    expect(r.caveat).toBe(CAVEAT);
    expect(r.caveat).toMatch(/not the same as unpaid/u);
    expect(r.caveat).toMatch(/No agent is named here as having failed/u);
  });

  it("never labels anything a default", () => {
    const r = buildReport([REAL], now);
    const serialised = JSON.stringify(r).toLowerCase();
    expect(serialised).not.toContain("defaulted");
    expect(r.rows.every((x) => x.status !== ("DEFAULTED" as never))).toBe(true);
  });

  it("handles an empty set without inventing totals", () => {
    const r = buildReport([], now);
    expect(r.totals.examined).toBe(0);
    expect(r.totals.valueUnresolvedUBA).toBe("0");
    expect(r.totals.soonestWindowClose).toBeNull();
  });
});
