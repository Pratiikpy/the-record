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

/**
 * The index must not restate the register from memory.
 *
 * The landing page carried the sentence "Six errata, three of which reached the
 * public" while the errata register held seven. A hand-typed count, sitting
 * directly above the very list that contradicts it — the same defect as a
 * headline promising defaults above a count of zero, and the same defect this
 * project files against other people. Numbers on a page that summarises a
 * register have to be COUNTED from that register.
 */
describe("the index counts the errata rather than remembering them", () => {
  const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "site", "index.html");

  it("states the true total", () => {
    const html = readFileSync(INDEX, "utf8");
    const m = /([0-9]+) errata, ([0-9]+) of which\s+reached the public/u.exec(html);
    expect(m, 'index should carry "<n> errata, <m> of which reached the public"').toBeTruthy();
    expect(Number(m![1]), "index errata total disagrees with ERRATA").toBe(ERRATA.length);
  });

  it("states the true published count", () => {
    const html = readFileSync(INDEX, "utf8");
    const m = /([0-9]+) errata, ([0-9]+) of which\s+reached the public/u.exec(html);
    const published = ERRATA.filter((e) => e.fate === "PUBLISHED").length;
    expect(Number(m![2]), "index published-errata count disagrees with ERRATA").toBe(published);
  });

  it("never spells a count as a word, because a word cannot be derived", () => {
    // "Six errata" is only constructable by hand. Digits come from the register.
    const html = readFileSync(INDEX, "utf8");
    expect(html).not.toMatch(/\b(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten) errata\b/u);
  });
});
