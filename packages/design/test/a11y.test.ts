import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

/**
 * Accessibility and semantics, asserted against the RENDERED pages.
 *
 * Contrast is already covered by tokens.test.ts, but contrast is only one
 * failure mode. These are the ones that do not show up in a screenshot: a
 * screen reader with no row headers to announce, a keyboard user with no
 * visible focus, a heading outline that jumps levels, a data table with no
 * caption. DESIGN.md commits to this content being evidence, and evidence that
 * only some people can read is not evidence.
 */
const PAGES: Array<[string, string]> = [
  ["index", join(ROOT, "site", "index.html")],
  ["covenant", join(ROOT, "packages", "covenant", "out", "index.html")],
  ["procedure", join(ROOT, "packages", "procedure", "out", "index.html")],
  ["reprod", join(ROOT, "packages", "reprod", "out", "index.html")],
  ["clinic", join(ROOT, "packages", "doctor", "out", "index.html")],
];

const html: Record<string, string> = {};

beforeAll(() => {
  for (const [name, path] of PAGES) {
    if (!existsSync(path)) throw new Error(`${name} not built at ${path} — run its build first`);
    html[name] = readFileSync(path, "utf8");
  }
});

const countOf = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe.each(PAGES.map(([n]) => n))("%s", (name) => {
  it("declares a document language", () => {
    expect(html[name]).toMatch(/<html lang="en">/u);
  });

  it("has exactly one h1", () => {
    expect(countOf(html[name]!, /<h1[\s>]/gu)).toBe(1);
  });

  it("never skips a heading level", () => {
    const levels = [...html[name]!.matchAll(/<h([1-3])[\s>]/gu)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!, `jump at index ${i}: h${levels[i - 1]}→h${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });

  it("gives every data table a caption", () => {
    const tables = countOf(html[name]!, /<table[\s>]/gu);
    expect(countOf(html[name]!, /<caption[\s>]/gu)).toBe(tables);
  });

  it("scopes every table header, so a screen reader can announce the row", () => {
    // Every th in these registers identifies either its row or its column. An
    // unscoped row header is announced as a column header and the row loses its
    // label entirely.
    //
    // `<th` also prefixes `<thead`, so the boundary matters — without it this
    // test failed on markup that was perfectly correct.
    const tables = countOf(html[name]!, /<table[\s>]/gu);
    const ths = [...html[name]!.matchAll(/<th(?=[\s>])[^>]*>/gu)].map((m) => m[0]);

    // The index uses definition lists, not tables. No headers there is correct,
    // not a finding — but a page WITH tables and no headers would be.
    if (tables === 0) {
      expect(ths.length).toBe(0);
      return;
    }

    expect(ths.length, "page has tables but no headers").toBeGreaterThan(0);
    const unscoped = ths.filter((t) => !t.includes("scope="));
    expect(unscoped.slice(0, 3)).toEqual([]);
  });

  it("uses scope=row for row headers and scope=col for column headers", () => {
    const ths = [...html[name]!.matchAll(/<th(?=[\s>])[^>]*>/gu)].map((m) => m[0]);
    const scopes = new Set(
      ths.map((t) => /scope="([a-z]+)"/u.exec(t)?.[1]).filter((s): s is string => s !== undefined),
    );
    for (const s of scopes) expect(["row", "col"]).toContain(s);
  });

  it("ships a visible keyboard focus style", () => {
    expect(html[name]).toMatch(/:focus-visible\{outline:/u);
  });

  it("honours prefers-reduced-motion", () => {
    expect(html[name]).toMatch(/prefers-reduced-motion:\s*reduce/u);
  });

  it("hides decorative marks from assistive tech", () => {
    // The corner crosses and the logo squares carry no meaning; announcing
    // "plus plus plus plus" before every section heading is actively hostile.
    expect(countOf(html[name]!, /aria-hidden="true"/gu)).toBeGreaterThan(0);
  });

  it("has no link with neither text nor an accessible name", () => {
    const empty = [...html[name]!.matchAll(/<a\b(?![^>]*aria-label)[^>]*>\s*<\/a>/gu)];
    expect(empty.length).toBe(0);
  });

  it("uses real landmarks rather than anonymous divs", () => {
    expect(html[name]).toMatch(/<header\b/u);
    expect(html[name]).toMatch(/<footer\b/u);
    expect(html[name]).toMatch(/<nav\b/u);
    expect(html[name], "content must live in a main landmark").toMatch(/<main\b/u);
  });

  it("labels the navigation, since a bare nav announces only its role", () => {
    expect(html[name]).toMatch(/<nav[^>]*aria-label="/u);
  });

  it("offers a skip link that actually targets the main landmark", () => {
    // Without it a keyboard user tabs the whole register nav on every page.
    expect(html[name]).toMatch(/class="skip" href="#main"/u);
    expect(html[name]).toMatch(/<main id="main">/u);
    // Off-screen until focused — a skip link that is always visible is a bug,
    // and one that never becomes visible is useless.
    expect(html[name]).toMatch(/\.skip\{position:absolute;left:-9999px/u);
    expect(html[name]).toMatch(/\.skip:focus\{left:/u);
  });

  it("keeps wide content in its own scroll container", () => {
    // The page body must never scroll sideways; tables scroll themselves.
    expect(html[name]).toMatch(/\.tablewrap\{overflow-x:auto/u);
  });

  it("declares the paper scheme, so form controls and scrollbars match the page", () => {
    // Light is the design, not a preference. Advertising "light dark" made the
    // browser render native chrome dark against a paper page.
    expect(html[name]).toMatch(/name="color-scheme" content="light"/u);
  });

  it("does not let the operating system pick the palette", () => {
    // The pages are proportioned, contrast-checked and printed as paper. A
    // viewer whose OS is dark used to be shown a different product by accident.
    expect(html[name]).not.toMatch(/prefers-color-scheme/u);
  });

  it("still offers dark as a deliberate choice", () => {
    expect(html[name]).toMatch(/data-toggle-theme/u);
    expect(html[name]).toMatch(/\[data-theme="dark"\]|data-theme="dark"/u);
  });

  it("sets a viewport so mobile breakpoints actually fire", () => {
    expect(html[name]).toMatch(/name="viewport" content="width=device-width,initial-scale=1"/u);
  });

  it("carries a meta description", () => {
    expect(html[name]).toMatch(/<meta name="description" content="[^"]{40,}"/u);
  });

  it("opens external links safely", () => {
    // target=_blank without noopener hands the opener to the target page.
    const blanks = [...html[name]!.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gu)];
    for (const m of blanks) {
      expect(m[0], "target=_blank without rel=noopener").toMatch(/rel="noopener"/u);
    }
  });
});

describe("cross-page consistency", () => {
  it("every page shares the same design tokens", () => {
    const tokenBlock = (s: string): string => /:root\{([\s\S]*?)\}/u.exec(s)![1]!;
    const first = tokenBlock(html.index!);
    for (const [name] of PAGES) {
      expect(tokenBlock(html[name]!), `${name} tokens drifted`).toBe(first);
    }
  });

  it("no page ships a placeholder link", () => {
    for (const [name] of PAGES) {
      expect(html[name], `${name} has a href="#"`).not.toMatch(/href="#"/u);
    }
  });
});

/**
 * Grid tracks must be able to shrink.
 *
 * `.stats` used `repeat(N, 1fr)`. A bare `1fr` is `minmax(auto, 1fr)`, and
 * `auto` floors at min-content — so one long unbreakable value (an evidence
 * digest, a contract address) widened its own column past the container. At
 * 390px the red-run panel measured 366px inside a 341px box and roughly 25px
 * was simply clipped.
 *
 * Nothing caught it because the DOCUMENT never scrolled sideways: the overflow
 * was contained and invisible, which is precisely why it needs a test rather
 * than an eye.
 */
describe("grid tracks can shrink below their content", () => {
  it.each(PAGES.map(([n]) => n))("%s uses minmax(0,1fr) for stat grids", (name) => {
    const doc = html[name]!;
    // Every stats grid declaration in the rendered stylesheet.
    const decls = [...doc.matchAll(/\.stats\{[^}]*grid-template-columns:([^;}]+)/gu)].map(
      (m) => m[1]!.trim(),
    );
    const media = [...doc.matchAll(/@media\([^)]*\)\{\.stats\{grid-template-columns:([^;}]+)/gu)].map(
      (m) => m[1]!.trim(),
    );
    const all = [...decls, ...media];
    expect(all.length, "no .stats grid declaration found").toBeGreaterThan(0);
    for (const d of all) {
      expect(d, `a bare 1fr cannot shrink: ${d}`).not.toMatch(/repeat\(\s*\d+\s*,\s*1fr\s*\)/u);
      expect(d).toMatch(/minmax\(0\s*,\s*1fr\)/u);
    }
  });

  it.each(PAGES.map(([n]) => n))("%s lets a long stat value break", (name) => {
    // tabular-nums plus an unbreakable hex string is how the column got wide.
    expect(html[name]!).toMatch(/\.stat \.v\{[^}]*overflow-wrap:anywhere/u);
  });
});
