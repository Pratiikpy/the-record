import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ERRATA, summariseErrata } from "../src/errata.js";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the discovery statistic is declared, not inferred", () => {
  // REGRESSION. The published "found by our own tests" figure was computed by
  // running a regex over the prose in `caughtBy`, searching for phrases like
  // "fault injection". Rewording a sentence silently changed a number on a
  // public page — a statistic that looked measured and was actually a
  // rendering, which is the exact defect this project exists to find.
  it("no summary field is derived from free text", () => {
    const src = readFileSync(join(HERE, "..", "src", "errata.ts"), "utf8");
    const summarise = src.slice(src.indexOf("export function summariseErrata"));
    expect(summarise).not.toMatch(/\.test\(|match\(|caughtBy/u);
  });

  it("every erratum declares how it was discovered", () => {
    for (const e of ERRATA) {
      expect(["OWN_MACHINERY", "WRITTEN_TEST", "REVIEW", "EXTERNAL"]).toContain(e.discovery);
    }
  });

  it("the discovery counts partition the errata exactly", () => {
    // If they do not sum to the total, some entry is uncounted and the page
    // under-reports without anyone noticing.
    const s = summariseErrata();
    expect(s.byOwnMachinery + s.byWrittenTest + s.byReview + s.byExternal).toBe(s.total);
  });

  it("the fate counts also partition exactly", () => {
    const s = summariseErrata();
    expect(s.published + s.caughtBeforePublication).toBe(s.total);
  });

  it("rewording caughtBy cannot change any published number", () => {
    const reworded = ERRATA.map((e) => ({ ...e, caughtBy: "something else entirely" }));
    expect(summariseErrata(reworded)).toEqual(summariseErrata(ERRATA));
  });
});

describe("errata discipline", () => {
  it("ids are unique and sequential", () => {
    const ids = ERRATA.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("every entry names a specific wrong value and a preventing test", () => {
    for (const e of ERRATA) {
      expect(e.claimed.length).toBeGreaterThan(30);
      expect(e.truth.length).toBeGreaterThan(20);
      expect(e.mechanism.length).toBeGreaterThan(50);
      expect(e.preventedBy.length).toBeGreaterThan(30);
    }
  });

  it("still records the errors that reached the public — none quietly reclassified", () => {
    // Downgrading a published error to caught-before-publication would be the
    // cheapest possible way to make this page flattering.
    expect(summariseErrata().published).toBeGreaterThanOrEqual(3);
    expect(ERRATA.find((e) => e.id === "E-001")?.fate).toBe("PUBLISHED");
  });
});
