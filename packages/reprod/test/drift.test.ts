import { describe, it, expect } from "vitest";
import { driftIsPublishable, MATERIALITY_RATIO, type DriftReport } from "../src/drift.js";

const report = (o: Partial<DriftReport>): DriftReport => ({
  state: "CURRENT",
  snapshotTotal: 250,
  liveTotal: 250,
  delta: 0,
  checkedAt: "2026-08-05T00:00:00.000Z",
  because: "",
  ...o,
});

describe("what may be published", () => {
  it("an exact match publishes", () => {
    expect(driftIsPublishable(report({ state: "CURRENT" }))).toBe(true);
  });

  it("an immaterial move publishes, because a gate that cries wolf gets switched off", () => {
    // The registry grew 250 -> 251 within twenty minutes of a scan. A strict
    // equality gate would block essentially every publish and would then be
    // disabled, at which point it protects nothing.
    expect(driftIsPublishable(report({ state: "IMMATERIAL", liveTotal: 251, delta: 1 }))).toBe(true);
  });

  it("a MATERIAL move BLOCKS", () => {
    expect(driftIsPublishable(report({ state: "MATERIAL", liveTotal: 300, delta: 50 }))).toBe(false);
  });

  it("UNKNOWN blocks — failing to check is not evidence nothing moved", () => {
    // Same discipline as a DISCLAIMER never rolling up as a pass.
    expect(driftIsPublishable(report({ state: "UNKNOWN", liveTotal: null, delta: null }))).toBe(false);
  });
});

describe("the materiality threshold", () => {
  const classify = (snapshot: number, live: number): "IMMATERIAL" | "MATERIAL" =>
    Math.abs(live - snapshot) / snapshot <= MATERIALITY_RATIO ? "IMMATERIAL" : "MATERIAL";

  it("REGRESSION: the drift we actually shipped is material", () => {
    // The site served 223 while the chain held 250 — a 12% error under a badge
    // that reported itself fresh. That must never be publishable.
    expect(classify(223, 250)).toBe("MATERIAL");
  });

  it("one machine in 250 is not material", () => {
    expect(classify(250, 251)).toBe("IMMATERIAL");
  });

  it("catches shrinkage as well as growth", () => {
    // Machines being removed is at least as interesting as machines appearing.
    expect(classify(250, 200)).toBe("MATERIAL");
  });

  it("is a ratio, so it scales with the fleet", () => {
    // Five machines is material in a fleet of 100 and not in a fleet of 1000.
    expect(classify(100, 105)).toBe("MATERIAL");
    expect(classify(1000, 1005)).toBe("IMMATERIAL");
  });

  it("sits at a threshold a reader can check", () => {
    expect(MATERIALITY_RATIO).toBeGreaterThan(0);
    expect(MATERIALITY_RATIO).toBeLessThan(0.1);
  });
});
