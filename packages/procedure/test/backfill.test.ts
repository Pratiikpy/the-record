/**
 * A DISCLAIMER must never be folded into a clean headline.
 *
 * Regenerating the series produced 45 CLEAN and one DISCLAIMER, and the page
 * headline read "No exception across 46 sampled heights" — literally true, and
 * it silently absorbed a height where the evidence was never established into
 * a sentence a reader takes as forty-six clean results.
 *
 * This is the project's own rule applied to its own prose: unknown is not
 * clean, and a refusal to conclude is a first-class result that has to survive
 * being summarised. The same page already shipped the inverse of this bug once
 * — § 2.4 asserted exceptions above forty-five clean rows — so the section is
 * now derived from the rows, and this guards the derivation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = join(HERE, "..", "out", "backfill.html");
const JSONF = join(HERE, "..", "out", "backfill.json");

interface Series {
  slots: number;
  tally: Record<string, number>;
  rows: Array<{ opinion: string }>;
}

function load(): { series: Series; html: string } {
  if (!existsSync(HTML) || !existsSync(JSONF)) {
    throw new Error("backfill output missing — run `pnpm -w run render:all` before the suite");
  }
  return {
    series: JSON.parse(readFileSync(JSONF, "utf8")) as Series,
    html: readFileSync(HTML, "utf8"),
  };
}

describe("the backfill headline cannot launder a disclaimer", () => {
  it("names the disclaimers whenever the series contains any", () => {
    const { series, html } = load();
    const disclaimers = series.rows.filter((r) => r.opinion === "DISCLAIMER").length;

    if (disclaimers === 0) {
      // The clause must not linger once the series no longer has one.
      expect(html).not.toMatch(/could not establish/u);
      return;
    }
    expect(
      html,
      `${disclaimers} row(s) are DISCLAIMER but the page never says so above the table`,
    ).toContain(`${disclaimers} height${disclaimers === 1 ? "" : "s"} we could not establish`);
    expect(html).toContain("never rounded up to a pass");
  });

  it("says how many heights actually held, rather than implying all of them did", () => {
    const { series, html } = load();
    const clean = series.rows.filter((r) => r.opinion === "CLEAN").length;
    if (clean !== series.rows.length) {
      expect(html, "the lede should state how many heights actually held").toContain(
        `held at the ${clean} heights`,
      );
    }
  });

  it("the tally and the rows are the same series", () => {
    // The stat tiles read the tally; the table reads the rows. If those ever
    // came from different runs the page would contradict itself silently.
    const { series } = load();
    const counted: Record<string, number> = {};
    for (const r of series.rows) counted[r.opinion] = (counted[r.opinion] ?? 0) + 1;
    expect(counted).toEqual(series.tally);
    expect(series.rows.length).toBe(series.slots);
  });

  it("an exception is never described as no exception", () => {
    const { series, html } = load();
    const exceptions = series.rows.filter((r) => r.opinion === "EXCEPTION").length;
    if (exceptions > 0) {
      expect(html).not.toMatch(/No exception across/u);
      expect(html).toContain(`${exceptions} exception`);
    } else {
      expect(html).toContain("No exception across");
    }
  });
});
