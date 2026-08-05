import { describe, it, expect } from "vitest";
import {
  grade,
  shortGrade,
  TIER_NAME,
  FALSIFICATION_BUDGET_DAYS,
  SCALE_DISCLAIMER,
  type GradeInput,
} from "../src/grade.js";

const NOW = new Date("2026-08-05T00:00:00.000Z");
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** Everything satisfied — the shape a fully falsified subject has. */
const FULL: GradeInput = {
  subject: "FXRP core vault",
  publiclyReadable: true,
  independentSources: 2,
  disagreementDetectable: true,
  lastFalsifiedAt: daysAgo(1),
  now: NOW,
};

describe("the ladder", () => {
  it("awards V3 when everything holds", () => {
    const g = grade(FULL);
    expect(g.tier).toBe(3);
    expect(shortGrade(g)).toBe("V3 FALSIFIED");
    expect(g.nextStep).toBeNull();
  });

  it("caps at V2 when the check has never been shown able to fail", () => {
    const g = grade({ ...FULL, lastFalsifiedAt: undefined });
    expect(g.tier).toBe(2);
    expect(g.criteria.find((c) => c.id === "V3.falsified")!.because).toMatch(/never been shown able to fail/u);
  });

  it("caps at V1 with only one source", () => {
    expect(grade({ ...FULL, independentSources: 1 }).tier).toBe(1);
  });

  it("caps at V1 when sources exist but a disagreement would not change the verdict", () => {
    // This is exactly the tautology we shipped: two figures compared, both
    // derived from one storage slot, so no disagreement was possible.
    expect(grade({ ...FULL, disagreementDetectable: false }).tier).toBe(1);
  });

  it("caps at V0 when the facts are not publicly readable", () => {
    expect(grade({ ...FULL, publiclyReadable: false }).tier).toBe(0);
  });

  it("a gap low down caps the subject regardless of a strong story higher up", () => {
    // A falsification test over facts nobody can read establishes nothing.
    const g = grade({ ...FULL, publiclyReadable: false, lastFalsifiedAt: daysAgo(1) });
    expect(g.tier).toBe(0);
    expect(g.name).toBe(TIER_NAME[0]);
  });
});

describe("V3 lapses", () => {
  it("holds inside the budget", () => {
    expect(grade({ ...FULL, lastFalsifiedAt: daysAgo(FALSIFICATION_BUDGET_DAYS - 1) }).tier).toBe(3);
  });

  it("DROPS once the falsification is too old", () => {
    // A falsification from six months ago says nothing about the code running
    // today. The tier has to be able to go down or it is a participation prize.
    const g = grade({ ...FULL, lastFalsifiedAt: daysAgo(FALSIFICATION_BUDGET_DAYS + 5) });
    expect(g.tier).toBe(2);
    expect(g.lapsed).toMatch(/lapsed/u);
  });

  it("says so explicitly rather than silently showing V2", () => {
    const g = grade({ ...FULL, lastFalsifiedAt: daysAgo(200) });
    expect(g.lapsed).toContain("200");
  });

  it("does not mark a never-falsified subject as lapsed", () => {
    // Never tested and gone stale are different states and must read differently.
    expect(grade({ ...FULL, lastFalsifiedAt: undefined }).lapsed).toBeUndefined();
  });

  it("refuses a falsification dated in the future", () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    const g = grade({ ...FULL, lastFalsifiedAt: future });
    expect(g.tier).toBe(2);
  });

  it("refuses an unparseable falsification date", () => {
    expect(grade({ ...FULL, lastFalsifiedAt: "whenever" }).tier).toBe(2);
  });
});

describe("evidence discipline", () => {
  it("an unevaluable criterion counts as NOT met, never as passed", () => {
    const g = grade({ subject: "unknown thing", now: NOW });
    expect(g.tier).toBe(0);
    for (const c of g.criteria) expect(c.met).toBe(false);
  });

  it("every criterion carries a reason, met or not", () => {
    for (const c of grade(FULL).criteria) expect(c.because.length).toBeGreaterThan(3);
  });

  it("names the single next thing that would raise the tier", () => {
    const g = grade({ ...FULL, lastFalsifiedAt: undefined });
    expect(g.nextStep).toMatch(/deliberately injected/u);
  });

  it("the scale states what it does not assert", () => {
    expect(SCALE_DISCLAIMER).toMatch(/not whether the system is safe/u);
    expect(SCALE_DISCLAIMER).toMatch(/not that nothing will/u);
  });
});

describe("the tiers are ordered and distinct", () => {
  it("names are unique", () => {
    const names = Object.values(TIER_NAME);
    expect(new Set(names).size).toBe(names.length);
  });

  it("a higher tier is strictly harder — relaxing any input can only lower it", () => {
    const base = grade(FULL).tier;
    const weakened: GradeInput[] = [
      { ...FULL, publiclyReadable: false },
      { ...FULL, independentSources: 1 },
      { ...FULL, disagreementDetectable: false },
      { ...FULL, lastFalsifiedAt: undefined },
    ];
    for (const w of weakened) expect(grade(w).tier).toBeLessThan(base);
  });
});
