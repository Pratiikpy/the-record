import { describe, it, expect } from "vitest";
import {
  outflowsOf,
  controlAllowlist,
  controlAllowlistIntegrity,
  controlEscrowBacking,
  controlLiquidBacking,
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

/**
 * The XRP Ledger's own view of the vault, read at ledger validation on the same
 * day. 50 escrow objects, 51 owned objects in total (the extra is the SignerList),
 * reserve 1,000,000 base + 200,000 × 51.
 */
const ON_LEDGER = {
  balanceDrops: "3631062341795",
  escrowedDrops: "500000000000",
  escrowCount: 50,
  reserveDrops: "11200000",
  nonXrpEscrows: 0,
};

const STATE: CoreVaultState = {
  coreVaultAddress: VAULT,
  custodianAddress: CUSTODIAN,
  allowedDestinations: ALLOWED,
  availableFundsUBA: "3628907217317",
  escrowedFundsUBA: "500000000000",
  immediatelyAvailableUBA: "3628907216917",
  reportedTotalUBA: "4128907216917",
  onLedger: ON_LEDGER,
};

/** The same period with XRPL unreachable — must disclaim, never pass. */
const NO_LEDGER: CoreVaultState = { ...STATE, onLedger: undefined };

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

describe("C3 — escrow backing", () => {
  it("is CLEAN on live data, where the two chains agree exactly", () => {
    // Flare's escrowedFunds is 500,000,000,000 UBA; the vault owns 50 Escrow
    // objects on XRPL totalling 500,000,000,000 drops. Not an approximation.
    const r = controlEscrowBacking(STATE);
    expect(r.opinion).toBe("CLEAN");
    expect(r.tested).toBe(50);
  });

  it("REGRESSION: the old identity was a tautology and could never fail", () => {
    // `escrowed == total - immediate` compared two outputs of one function that
    // both derive from escrowedFunds. Fault injection moved the storage slot
    // from 500,000,000,000 to 999,999,999,999 and the identity STILL held,
    // because both sides moved together. Evaluated by hand here, the old
    // assertion passes on the live figures — which is exactly the problem: it
    // passes on every figure.
    const total = BigInt(STATE.reportedTotalUBA!);
    const immediate = BigInt(STATE.immediatelyAvailableUBA!);
    expect(BigInt(STATE.escrowedFundsUBA)).toBe(total - immediate);
    // The replacement, given the same corruption, does not pass.
    expect(controlEscrowBacking({ ...STATE, escrowedFundsUBA: "999999999999" }).opinion).toBe("EXCEPTION");
  });

  it("FIRES when Flare records more escrow than XRPL holds, and names the gap", () => {
    const r = controlEscrowBacking({ ...STATE, escrowedFundsUBA: "999999999999" });
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.exceptions[0]).toContain("499999999999");
    expect(r.exceptions[0]).toMatch(/unbacked/u);
  });

  it("FIRES in the other direction too — unrecorded escrow is also a breach", () => {
    // XRP leaving the liquid balance without Flare booking it is a real fault,
    // not a conservative rounding. A one-sided control would miss it.
    const r = controlEscrowBacking({ ...STATE, escrowedFundsUBA: "400000000000" });
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.exceptions[0]).toContain("100000000000");
    expect(r.exceptions[0]).toMatch(/unrecorded/u);
  });

  it("DISCLAIMS rather than guessing when an escrow is not XRP-denominated", () => {
    // Summing a non-XRP escrow as zero would understate the ledger and
    // manufacture a shortfall — the same false accusation, one amendment later.
    const r = controlEscrowBacking({
      ...STATE,
      onLedger: { ...ON_LEDGER, nonXrpEscrows: 1 },
    });
    expect(r.opinion).toBe("DISCLAIMER");
    expect(r.disclaimer).toMatch(/manufacture a shortfall/u);
  });

  it("DISCLAIMS when XRPL could not be read", () => {
    expect(controlEscrowBacking(NO_LEDGER).opinion).toBe("DISCLAIMER");
  });
});

describe("C4 — liquid backing", () => {
  it("is CLEAN on live data", () => {
    expect(controlLiquidBacking(STATE).opinion).toBe("CLEAN");
  });

  it("REGRESSION: escrowed XRP must not be added to the balance", () => {
    // XRPL escrow REMOVES XRP from account_data.Balance and holds it in Escrow
    // objects. An earlier version asserted `available + escrowed <= Balance`
    // and reported a 497,844,875,522 drop shortfall against live Flare. That
    // shortfall was double-counting, not a hole. This asserts the arithmetic
    // that would have produced the false accusation, so it can never quietly
    // return.
    const wrong = BigInt(STATE.availableFundsUBA) + BigInt(STATE.escrowedFundsUBA);
    expect(wrong - BigInt(ON_LEDGER.balanceDrops)).toBe(497_844_875_522n);
    expect(controlLiquidBacking(STATE).opinion).toBe("CLEAN");
  });

  it("FIRES when Flare claims more than the ledger can pay", () => {
    const r = controlLiquidBacking({ ...STATE, availableFundsUBA: "3631062341795" });
    expect(r.opinion).toBe("EXCEPTION");
    // claimed equals the full balance, so the shortfall is exactly the reserve
    expect(r.exceptions[0]).toContain("11200000");
  });

  it("counts the reserve as unspendable, not as cover", () => {
    // One drop below the reserve boundary passes; one drop above does not.
    const edge = BigInt(ON_LEDGER.balanceDrops) - BigInt(ON_LEDGER.reserveDrops);
    expect(controlLiquidBacking({ ...STATE, availableFundsUBA: edge.toString() }).opinion).toBe("CLEAN");
    expect(controlLiquidBacking({ ...STATE, availableFundsUBA: (edge + 1n).toString() }).opinion).toBe(
      "EXCEPTION",
    );
  });

  it("treats a ledger surplus as an observation, not a fault", () => {
    // Deposits are backed before they are credited, so XRPL routinely holds
    // more than Flare claims. Flagging that would cry wolf every day.
    const r = controlLiquidBacking(STATE);
    expect(r.opinion).toBe("CLEAN");
    expect(r.observation).toMatch(/to spare/u);
  });

  it("DISCLAIMS when XRPL could not be read", () => {
    expect(controlLiquidBacking(NO_LEDGER).opinion).toBe("DISCLAIMER");
  });
});

describe("C5 — fee wedge is disclosed, not judged", () => {
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
    // The XRPL side is evidence too — a run over a different ledger state must
    // not carry an identical digest.
    expect(evidenceDigest(base, STATE)).not.toBe(
      evidenceDigest(base, { ...STATE, onLedger: { ...ON_LEDGER, balanceDrops: "1" } }),
    );
    expect(evidenceDigest(base, STATE)).not.toBe(evidenceDigest(base, NO_LEDGER));
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
    expect(r.controls).toHaveLength(5);
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

  it("an unreachable XRP Ledger DISCLAIMS the period rather than passing it", () => {
    // Half the evidence is off-chain. If XRPL is down, two of five controls
    // cannot conclude, and the period must say so.
    const txs = [tx({ hash: "a", destination: ALLOWED[0] })];
    expect(runCv1(txs, NO_LEDGER, "d").opinion).toBe("DISCLAIMER");
  });

  it("a cross-chain shortfall turns the period into an EXCEPTION", () => {
    const txs = [tx({ hash: "a", destination: ALLOWED[0] })];
    const r = runCv1(txs, { ...STATE, escrowedFundsUBA: "999999999999" }, "d");
    expect(r.opinion).toBe("EXCEPTION");
    expect(r.controls.find((c) => c.id === "C3")?.opinion).toBe("EXCEPTION");
  });
});

describe("xrplTimeToUnix", () => {
  it("applies the 2000-01-01 ripple epoch offset", () => {
    expect(XRPL_EPOCH_OFFSET).toBe(946_684_800);
    expect(xrplTimeToUnix(0)).toBe(946_684_800);
    expect(xrplTimeToUnix(1)).toBe(946_684_801);
  });
});


