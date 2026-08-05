import { describe, it, expect } from "vitest";
import { FAULTS, scoreFault, adjudicateSkew, KNOWN_UNCAUGHT, type Fault } from "../src/faults.js";
import { runCv1, type CoreVaultState, type Opinion } from "../src/cv1.js";
import type { XrplTx } from "../src/xrpl.js";

/** Live Coston2 / XRPL testnet values, 2026-08-04 — the same fixture CV-1 uses. */
const VAULT = "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p";
const CUSTODIAN = "r3GhxcaM4f9BJXEu1JLRgDXZpHJw6ugkH4";
const ALLOWED = [
  "r4uKJRy9mjxGHw1yzS1SrtaKCUwT66MCcP",
  "rDEXUmuYAe9MCxVfoWArptSZNQPjKpRCXd",
  "rDYeqGVc8M3Se9wowvRDbURGYGZ5i5VF6r",
  "r4GHJwGSaGmJy9BBXS9osFXqRjqdSm7v83",
];

const GREEN: CoreVaultState = {
  coreVaultAddress: VAULT,
  custodianAddress: CUSTODIAN,
  allowedDestinations: ALLOWED,
  availableFundsUBA: "3628907217317",
  escrowedFundsUBA: "500000000000",
  immediatelyAvailableUBA: "3628907216917",
  reportedTotalUBA: "4128907216917",
  onLedger: {
    balanceDrops: "3631062341795",
    escrowedDrops: "500000000000",
    escrowCount: 50,
    reserveDrops: "11200000",
    nonXrpEscrows: 0,
  },
};

/** One allowlisted outflow, so C1 has something to test and does not disclaim. */
const TXS: XrplTx[] = [
  { hash: "h0", type: "Payment", account: VAULT, destination: ALLOWED[0], ledgerIndex: 100, successful: true },
];

const opinions = (s: CoreVaultState): Record<string, Opinion> =>
  Object.fromEntries(runCv1(TXS, s, "test").controls.map((c) => [c.id, c.opinion]));

const BEFORE = opinions(GREEN);

describe("the green baseline", () => {
  it("is CLEAN on every control, or a fault proves nothing", () => {
    // If the baseline were already exceptional, a red result after injection
    // would be indistinguishable from the pre-existing state.
    expect(Object.values(BEFORE).every((o) => o === "CLEAN")).toBe(true);
  });
});

describe("the fault catalogue", () => {
  it("every fault declares both what must fire and what must not move", () => {
    for (const f of FAULTS) {
      expect(f.mustFire).toBeDefined();
      expect(f.mustNotMove.length).toBeGreaterThan(0);
      expect(f.proves.length).toBeGreaterThan(20);
      expect(f.doesNotProve.length).toBeGreaterThan(20);
    }
  });

  it("fault ids are unique", () => {
    const ids = FAULTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no fault claims a control both fires and stays put", () => {
    for (const f of FAULTS) {
      const overlap = f.mustFire.filter((id) => f.mustNotMove.includes(id));
      expect(overlap).toEqual([]);
    }
  });

  it.each(FAULTS.map((f) => [f.id, f] as [string, Fault]))(
    "%s fires exactly what it declares, and nothing else",
    (_id, f) => {
      const after = opinions(f.apply(GREEN));
      const outcome = scoreFault(f, BEFORE, after);

      // Reported together so a failure names which half broke.
      expect({
        id: f.id,
        missingFires: outcome.missingFires,
        movedWhenItShouldNot: outcome.movedWhenItShouldNot,
      }).toEqual({ id: f.id, missingFires: [], movedWhenItShouldNot: [] });
    },
  );

  it("FAULT-00 changes nothing at all — the harness's own control", () => {
    const after = opinions(FAULTS.find((f) => f.id === "FAULT-00")!.apply(GREEN));
    expect(after).toEqual(BEFORE);
  });

  it("the null fault would be caught by a runner that requires a fire", () => {
    // A runner asserting "some control must go EXCEPTION" must reject FAULT-00.
    const after = opinions(FAULTS[0]!.apply(GREEN));
    expect(Object.values(after).some((o) => o === "EXCEPTION")).toBe(false);
  });

  it("losing the independent source DISCLAIMS rather than passing", () => {
    const f = FAULTS.find((x) => x.id === "FAULT-06")!;
    const after = opinions(f.apply(GREEN));
    expect(after.C3).toBe("DISCLAIMER");
    expect(after.C4).toBe("DISCLAIMER");
    expect(after.C3).not.toBe("CLEAN");
  });

  it("covers both fault classes, not just storage corruption", () => {
    const classes = new Set(FAULTS.map((f) => f.class));
    expect(classes.has("chain-state")).toBe(true);
    expect(classes.has("transport")).toBe(true);
    expect(classes.has("null")).toBe(true);
  });

  it("every control in scope is fired by at least one fault", () => {
    // A control no fault can move has never been shown capable of failing.
    const fired = new Set(FAULTS.flatMap((f) => f.mustFire));
    for (const id of ["C2", "C3", "C4"]) expect(fired.has(id)).toBe(true);
  });
});

describe("the suite can fail", () => {
  // Every fault passed on the first run. That is the exact shape of a test
  // that is not testing anything, so the harness is checked against
  // deliberately wrong declarations before its green result is believed.
  const real = FAULTS.find((f) => f.id === "FAULT-01")!;

  it("catches a fault that claims a control fires when it does not", () => {
    const lying: Fault = { ...real, mustFire: [...real.mustFire, "C5"] };
    const outcome = scoreFault(lying, BEFORE, opinions(lying.apply(GREEN)));
    expect(outcome.pass).toBe(false);
    expect(outcome.missingFires).toEqual(["C5"]);
  });

  it("catches a fault that claims a control stays put when it moves", () => {
    const lying: Fault = { ...real, mustFire: [], mustNotMove: ["C3"] };
    const outcome = scoreFault(lying, BEFORE, opinions(lying.apply(GREEN)));
    expect(outcome.pass).toBe(false);
    expect(outcome.movedWhenItShouldNot).toEqual(["C3"]);
  });

  it("catches a fault whose apply() does nothing but claims a fire", () => {
    const inert: Fault = { ...real, apply: (s) => s };
    const outcome = scoreFault(inert, BEFORE, opinions(inert.apply(GREEN)));
    expect(outcome.pass).toBe(false);
  });
});

describe("adjudicateSkew — the safeguard that had never fired", () => {
  // Across 119 backfilled heights this suppressed nothing. Zero suppressions is
  // either "no artifacts occurred" or "the bracket cannot suppress", and only a
  // deliberate test tells you which. That is the same lesson C3 taught.
  it("confirms when every readable bracket height agrees", () => {
    expect(adjudicateSkew(["C3"], [true, true]).confirmed).toBe(true);
  });

  it("SUPPRESSES when a bracket height disagrees", () => {
    const r = adjudicateSkew(["C3"], [true, false]);
    expect(r.confirmed).toBe(false);
    expect(r.reason).toMatch(/skew/u);
  });

  it("suppresses when no bracket height agrees at all", () => {
    expect(adjudicateSkew(["C3"], [false, false]).confirmed).toBe(false);
  });

  it("refuses to confirm an unadjudicated candidate", () => {
    // If no neighbour could be read the exception was never tested. Publishing
    // it would be precisely the false accusation the bracket exists to prevent.
    const r = adjudicateSkew(["C3"], []);
    expect(r.confirmed).toBe(false);
    expect(r.reason).toMatch(/unadjudicated/u);
  });

  it("has nothing to adjudicate when no control breached", () => {
    expect(adjudicateSkew([], [true, true]).confirmed).toBe(false);
  });
});

describe("the uncaught list", () => {
  it("is not empty — a suite that catches everything is measuring its own imagination", () => {
    expect(KNOWN_UNCAUGHT.length).toBeGreaterThan(0);
    for (const u of KNOWN_UNCAUGHT) expect(u.why.length).toBeGreaterThan(40);
  });

  it("names the structural limit of a two-source reconciliation", () => {
    expect(KNOWN_UNCAUGHT.map((u) => u.why).join(" ")).toMatch(/does not exist between its two sources/u);
  });
});

describe("scoreFault", () => {
  const f = FAULTS.find((x) => x.id === "FAULT-01")!;

  it("fails when a required control did not fire", () => {
    const r = scoreFault(f, { C3: "CLEAN" }, { C3: "CLEAN" });
    expect(r.pass).toBe(false);
    expect(r.missingFires).toEqual(["C3"]);
  });

  it("fails when an unrelated control moved — the false-positive side", () => {
    const r = scoreFault(f, { C3: "CLEAN", C5: "CLEAN" }, { C3: "EXCEPTION", C5: "EXCEPTION" });
    expect(r.firedAsRequired).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.movedWhenItShouldNot).toEqual(["C5"]);
  });

  it("passes only when both halves hold", () => {
    const r = scoreFault(f, { C3: "CLEAN", C5: "CLEAN" }, { C3: "EXCEPTION", C5: "CLEAN" });
    expect(r.pass).toBe(true);
  });
});

