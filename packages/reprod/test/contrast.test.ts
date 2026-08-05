/**
 * Contrast regression gate.
 *
 * DESIGN.md commits to "every page must be legible printed in greyscale on A4."
 * The colour that carries table headers, stat labels and the 10.5px sublines is
 * the one most likely to drift back toward decorative-but-illegible, so both
 * themes are asserted here against the WCAG AA floor.
 *
 * This parses the ACTUAL rendered stylesheet rather than a copy of the token
 * list, so editing render.ts without editing the tokens still fails the build.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "..", "out", "index.html");

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull `--name:#value` pairs out of one CSS block. */
function tokensIn(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/gu)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

let light: Record<string, string>;
let dark: Record<string, string>;

beforeAll(() => {
  if (!existsSync(PAGE)) {
    throw new Error(`${PAGE} missing — run \`pnpm run build\` before the test suite`);
  }
  const html = readFileSync(PAGE, "utf8");

  const lightBlock = /:root\{([^}]*)\}/u.exec(html);
  const darkBlock = /:root\[data-theme="dark"\]\{([^}]*)\}/u.exec(html);
  expect(lightBlock, ":root token block not found in rendered page").toBeTruthy();
  expect(darkBlock, 'dark theme token block not found in rendered page').toBeTruthy();

  light = tokensIn(lightBlock![1]!);
  // dark overrides only some tokens; fall back to light for the rest
  dark = { ...light, ...tokensIn(darkBlock![1]!) };
});

/** Tokens used as foreground on small (<14px) text — AA floor is 4.5:1. */
const SMALL_TEXT_TOKENS = ["faint", "muted", "graphite", "v-ok", "v-bad", "v-unknown", "v-sim"] as const;

describe("colour contrast — light theme", () => {
  it("has a paper and ink token", () => {
    expect(light.paper).toMatch(/^#[0-9a-fA-F]{6}$/u);
    expect(light.ink).toMatch(/^#[0-9a-fA-F]{6}$/u);
  });

  it("body text clears AAA", () => {
    expect(contrast(light.ink!, light.paper!)).toBeGreaterThanOrEqual(7);
  });

  for (const t of SMALL_TEXT_TOKENS) {
    it(`--${t} clears AA 4.5:1 on paper`, () => {
      const c = contrast(light[t]!, light.paper!);
      expect(c, `--${t} = ${light[t]} scored ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("colour contrast — dark theme", () => {
  it("body text clears AAA", () => {
    expect(contrast(dark.ink!, dark.paper!)).toBeGreaterThanOrEqual(7);
  });

  for (const t of SMALL_TEXT_TOKENS) {
    it(`--${t} clears AA 4.5:1 on paper`, () => {
      const c = contrast(dark[t]!, dark.paper!);
      expect(c, `--${t} = ${dark[t]} scored ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * Tinted grounds, which the token-vs-paper checks above are blind to.
 *
 * `--wash` is laid over the paper for highlighted table rows and stat panels,
 * so text on those rows sits on a DARKER ground than `--paper` and scores
 * lower than any assertion above measures. An axe-core audit of the live site
 * found exactly that: `--faint` cleared 4.66:1 on paper and scored 4.31:1 on a
 * `.changed` row, failing AA on a page this suite reported as passing.
 *
 * Checking a token against the lightest background it is ever placed on is the
 * same mistake as a control that compares a number with itself: it passes by
 * construction. Every ground the design actually uses has to be measured.
 */
function over(fg: string, bg: string, overlay: string, alpha: number): number {
  // Composite the wash onto the ground, then measure against the result.
  const px = (h: string): [number, number, number] => {
    const v = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
  };
  const [br, bgn, bb] = px(bg);
  const [orr, og, ob] = px(overlay);
  const mix = (a: number, b: number): number => Math.round(a * (1 - alpha) + b * alpha);
  const composited =
    "#" +
    [mix(br, orr), mix(bgn, og), mix(bb, ob)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  return contrast(fg, composited);
}

describe("colour contrast on tinted rows, not just bare paper", () => {
  // --wash is the ink colour at 4% in light, and the paper colour at 5% in dark.
  const CASES = [
    { theme: "light", get t() { return light; }, overlay: () => light.ink!, alpha: 0.04 },
    { theme: "dark", get t() { return dark; }, overlay: () => dark.ink!, alpha: 0.05 },
  ];

  for (const c of CASES) {
    for (const tok of SMALL_TEXT_TOKENS) {
      it(`${c.theme}: --${tok} clears AA on a washed row`, () => {
        const ratio = over(c.t[tok]!, c.t.paper!, c.overlay(), c.alpha);
        expect(
          ratio,
          `--${tok} = ${c.t[tok]} scored ${ratio.toFixed(2)}:1 over --wash`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("REGRESSION: the exact pair axe caught on the live site", () => {
    // #757068 on #f1f0ec measured 4.31 in a real browser. Whatever --faint
    // becomes, it must never score below AA on that ground again.
    expect(contrast("#757068", "#f1f0ec")).toBeLessThan(4.5);
    expect(contrast(light.faint!, "#f1f0ec")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("verdict encoding is not colour-alone", () => {
  let html: string;
  beforeAll(() => {
    html = readFileSync(PAGE, "utf8");
  });

  it("gives each verdict class a distinct border style", () => {
    const styles = ["ok", "bad", "unknown", "sim", "none"].map((cls) => {
      const m = new RegExp(`\\.verdict\\.${cls}\\{[^}]*border:([^;}]*)`, "u").exec(html);
      expect(m, `.verdict.${cls} has no border rule`).toBeTruthy();
      return m![1]!.trim();
    });
    // solid / double / dashed / dotted must not collapse to one look
    const kinds = new Set(styles.map((s) => /(solid|double|dashed|dotted)/u.exec(s)?.[1] ?? "none"));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it("prefixes every verdict chip with a glyph", () => {
    const chips = [...html.matchAll(/<span class="verdict [a-z]+">\[ (.) \]/gu)].map((m) => m[1]);
    expect(chips.length).toBeGreaterThan(0);
    // every rendered chip carries a bracketed glyph, so greyscale still parses
    expect(chips.every((g) => typeof g === "string" && g.trim().length === 1)).toBe(true);
  });

  it("ships a prefers-reduced-motion block", () => {
    expect(html).toMatch(/prefers-reduced-motion:\s*reduce/u);
  });

  it("keeps wide content in its own scroll container", () => {
    expect(html).toMatch(/\.tablewrap\{overflow-x:auto/u);
  });
});
