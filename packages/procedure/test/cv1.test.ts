import { describe, it, expect } from "vitest";
import {
  outflowsOf,
  controlAllowlist,
  controlAllowlistIntegrity,
  controlEscrowReconciliation,
  observeFeeWedge,
  rollUp,
  evidenceDigest,
  runCv1,
  type CoreVaultState,
  type ControlResult,
} from "../src/cv1.js";
import type { XrplTx } from "../src/xrpl.js";
import { xrplTimeToUnix, XRPL_EPOCH_OFFSET } from "../src/xrpl.js";

/** Live Coston2 / XRPL testnet values, 2026-08-04. */
const VAULT = "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p";
const CUSTODIAN = "r3GhxcaM4f9BJXEu1JLRgDXZpHJw6ugkH4";
const ALLOWED = [
  "r4uKJRy9mjxGHw1yzS1SrtaKCUwT66MCcP",
  "rDEXUmuYAe9MCxVfoWArptSZNQPjKpRCXd",
  "rDYeqGVc8M3Se9wowvRDbURGYGZ5i5VF6r",
  "r4GHJwGSaGmJy9BBXS9osFXqRjqdSm7v83",
];

const STATE: CoreVaultState = {
  coreVaultAddress: VAULT,
  custodianAddress: CUSTODIAN,
  allowedDestinations: ALLOWED,
  availableFundsUBA: "3628907217317",
  escrowedFundsUBA: "500000000000",
  immediatelyAvailableUBA: "3628907216917",
  reportedTotalUBA: "4128907216917",
};

const tx = (o: Partial<XrplTx>): XrplTx => ({
  hash: "H",
  type: "Payment",
  account: VAULT,
  ledgerIndex: 1,
  successful: true,
  ...o,
});

describe("outflowsOf", () => {
  it("counts only successful payments sent by the vault", () => {
    const txs = [
      tx({ hash: "a", destination: ALLOWED[0] }),
      tx({ hash: "b", destination: ALLOWED[0], successful: false }), // failed
      tx({ hash: "c", destination: ALLOWED[0], type: "EscrowFinish" }), // not a payment
      tx({ hash: "d", destination: VAULT, account: "rSomeoneElse" }), // inbound
    ];
    expect(outflowsOf(txs, VAULT).map((t) => t.hash)).toEqual(["a"]);
  });

  it("a failed payment is never an outflow", () => {
    // Counting a tesFAIL as an outflow would score a payment that moved no
    // value as a control breach.
    const txs = [tx({ hash: "x", destination: "rEvil", successful: false })];
    expect(outflowsOf(txs, VAULT)).toHaveLength(0);
  });
});

describe("C1 — outflow allowlist", () => {
  it("is CLEAN when every outflow is allowlisted", () => {
    const outs = ALLOWED.map((d, i) => tx({ hash: `h${i}`, destination: d }));
    const r = controlAllowlist(outs, STATE);
    expect(r.opinion).toBe("CLEAN");
    expect(r.tested).toBe(4);
  });

  it("permits the custodian even though it is not in the destination allowlist", () => {
    const r = controlAllowlist([tx({ destination: CUSTODIAN })], STATE);
    expect(r.opinion).toBe("CLEAN");
  });

  it("raises an EXCEPTION naming the unpermitted destination", () => {
    const r = controlAllowlist([tx({ hash: "bad", destination: "rNotAllowed111" })], STATE);
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.exceptions[0]).toContain("rNotAllowed111");
    expect(r.exceptions[0]).toContain("bad");
  });

  it("treats a payment with no destination as an exception, not a pass", () => {
    const r = controlAllowlist([tx({ hash: "nodest", destination: undefined })], STATE);
    expect(r.opinion).toBe("EXCEPTION");
  });

  it("DISCLAIMS rather than passing when there is nothing to test", () => {
    // "No outflows" is not compliance. Reporting CLEAN here would be the
    // single easiest way for this product to become dishonest.
    const r = controlAllowlist([], STATE);
    expect(r.opinion).toBe("DISCLAIMER");
    expect(r.disclaimer).toMatch(/not the same as compliance/u);
  });
});

describe("C2 — control preconditions", () => {
  it("is CLEAN on the live state", () => {
    expect(controlAllowlistIntegrity(STATE).opinion).toBe("CLEAN");
  });

  it("flags an empty allowlist, which would make C1 vacuously strict", () => {
    const r = controlAllowlistIntegrity({ ...STATE, allowedDestinations: [] });
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.exceptions.join()).toMatch(/empty/u);
  });

  it("flags a missing custodian, which would make C1 vacuously loose", () => {
    const r = controlAllowlistIntegrity({ ...STATE, custodianAddress: "" });
    expect(r.opinion).toBe("EXCEPTION");
  });

  it("flags duplicate allowlist entries", () => {
    const r = controlAllowlistIntegrity({
      ...STATE,
      allowedDestinations: [...ALLOWED, ALLOWED[0]!],
    });
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.exceptions.join()).toContain(ALLOWED[0]!);
  });
});

describe("C3 — escrow reconciliation", () => {
  it("is CLEAN on the live state", () => {
    expect(controlEscrowReconciliation(STATE).opinion).toBe("CLEAN");
  });

  it("REGRESSION: does not manufacture a breach from the fee wedge", () => {
    // The original control asserted `available + escrowed <= total` across two
    // contracts and flagged a 400 UBA "breach" against Flare. Those figures
    // were never defined to relate. A false accusation is far more damaging
    // than a missed finding, so this must stay CLEAN.
    const r = controlEscrowReconciliation(STATE);
    expect(r.opinion).toBe("CLEAN");
    expect(r.exceptions).toEqual([]);

    const available = BigInt(STATE.availableFundsUBA);
    const escrowed = BigInt(STATE.escrowedFundsUBA);
    const total = BigInt(STATE.reportedTotalUBA!);
    expect(available + escrowed).toBeGreaterThan(total); // the old assertion WOULD fire
  });

  it("tests the identity that actually holds", () => {
    const escrowed = BigInt(STATE.escrowedFundsUBA);
    const total = BigInt(STATE.reportedTotalUBA!);
    const immediate = BigInt(STATE.immediatelyAvailableUBA!);
    expect(escrowed).toBe(total - immediate);
  });

  it("raises an EXCEPTION when escrow genuinely does not reconcile", () => {
    const r = controlEscrowReconciliation({ ...STATE, escrowedFundsUBA: "123" });
    expect(r.opinion).toBe("EXCEPTION");
  });

  it("raises an EXCEPTION if the vault advertises more than it holds", () => {
    // The direction that IS a real breach: the system offering funds the vault
    // does not have.
    const r = controlEscrowReconciliation({
      ...STATE,
      availableFundsUBA: "1",
      escrowedFundsUBA: (BigInt(STATE.reportedTotalUBA!) - BigInt(STATE.immediatelyAvailableUBA!)).toString(),
    });
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.exceptions.join()).toMatch(/below/u);
  });

  it("DISCLAIMS when the asset manager figures were not obtained", () => {
    const r = controlEscrowReconciliation({
      ...STATE,
      reportedTotalUBA: undefined,
      immediatelyAvailableUBA: undefined,
    });
    expect(r.opinion).toBe("DISCLAIMER");
  });
});

describe("C4 — fee wedge is disclosed, not judged", () => {
  it("reports the wedge as an observation with a CLEAN opinion", () => {
    const r = observeFeeWedge(STATE);
    expect(r.opinion).toBe("CLEAN");
    expect(r.observation).toContain("400");
    expect(r.exceptions).toEqual([]);
  });
});

describe("rollUp", () => {
  const c = (opinion: ControlResult["opinion"]): ControlResult => ({
    id: "X",
    title: "t",
    assertion: "a",
    opinion,
    tested: 1,
    exceptions: [],
  });

  it("EXCEPTION dominates everything", () => {
    expect(rollUp([c("CLEAN"), c("DISCLAIMER"), c("EXCEPTION")])).toBe("EXCEPTION");
  });

  it("DISCLAIMER outranks CLEAN — a period with missing evidence is not clean", () => {
    expect(rollUp([c("CLEAN"), c("DISCLAIMER")])).toBe("DISCLAIMER");
  });

  it("is CLEAN only when every control concluded cleanly", () => {
    expect(rollUp([c("CLEAN"), c("CLEAN")])).toBe("CLEAN");
  });

  it("an empty control set is CLEAN only because there is nothing to roll up", () => {
    expect(rollUp([])).toBe("CLEAN");
  });
});

describe("evidenceDigest", () => {
  it("is stable across runs over identical evidence", () => {
    const txs = [tx({ hash: "a", destination: ALLOWED[0] })];
    expect(evidenceDigest(txs, STATE)).toBe(evidenceDigest(txs, STATE));
  });

  it("changes when any evidence changes", () => {
    const base = [tx({ hash: "a", destination: ALLOWED[0] })];
    const more = [...base, tx({ hash: "b", destination: ALLOWED[1] })];
    expect(evidenceDigest(base, STATE)).not.toBe(evidenceDigest(more, STATE));
    expect(evidenceDigest(base, STATE)).not.toBe(
      evidenceDigest(base, { ...STATE, escrowedFundsUBA: "1" }),
    );
  });

  it("does not depend on allowlist ordering", () => {
    const txs = [tx({ hash: "a" })];
    const reordered = { ...STATE, allowedDestinations: [...ALLOWED].reverse() };
    expect(evidenceDigest(txs, STATE)).toBe(evidenceDigest(txs, reordered));
  });
});

describe("runCv1 — full report", () => {
  it("produces a CLEAN opinion over the live-shaped evidence", () => {
    const txs = ALLOWED.map((d, i) => tx({ hash: `h${i}`, destination: d, ledgerIndex: 100 + i }));
    const r = runCv1(txs, STATE, "2026-08-04");
    expect(r.opinion).toBe("CLEAN");
    expect(r.controls).toHaveLength(4);
    expect(r.evidence.outflows).toBe(4);
    expect(r.evidence.ledgerRange).toEqual([100, 103]);
  });

  it("one bad destination turns the whole period into an EXCEPTION", () => {
    const txs = [tx({ hash: "ok", destination: ALLOWED[0] }), tx({ hash: "bad", destination: "rBad" })];
    expect(runCv1(txs, STATE, "d").opinion).toBe("EXCEPTION");
  });

  it("no evidence yields a DISCLAIMER, never a clean period", () => {
    expect(runCv1([], STATE, "d").opinion).toBe("DISCLAIMER");
  });
});

describe("xrplTimeToUnix", () => {
  it("applies the 2000-01-01 ripple epoch offset", () => {
    expect(XRPL_EPOCH_OFFSET).toBe(946_684_800);
    expect(xrplTimeToUnix(0)).toBe(946_684_800);
    expect(xrplTimeToUnix(1)).toBe(946_684_801);
  });
});
