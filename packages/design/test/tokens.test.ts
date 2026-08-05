import { describe, it, expect } from "vitest";
import { TOKENS, BASE_CSS, page, marker, stat, esc, short } from "../src/index.js";

/**
 * The shared design system is now the single source of truth for both
 * registers, so its tokens are asserted here rather than in each consumer.
 * DESIGN.md commits to "every page must be legible printed in greyscale on A4";
 * these are the numbers behind that promise.
 */

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
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/gu)) out[m[1]!] = m[2]!;
  return out;
}

const LIGHT = tokensIn(/:root\{([\s\S]*?)\}/u.exec(TOKENS)![1]!);
const DARK = {
  ...LIGHT,
  ...tokensIn(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/u.exec(TOKENS)![1]!),
};

/** Tokens that appear as foreground on text below 14px. AA floor: 4.5:1. */
const SMALL_TEXT = ["faint", "muted", "graphite", "v-ok", "v-bad", "v-unknown", "v-sim"] as const;

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("%s theme contrast", (_name, T) => {
  it("body text clears AAA (7:1)", () => {
    expect(contrast(T.ink!, T.paper!)).toBeGreaterThanOrEqual(7);
  });

  for (const t of SMALL_TEXT) {
    it(`--${t} clears AA (4.5:1)`, () => {
      const c = contrast(T[t]!, T.paper!);
      expect(c, `--${t} = ${T[t]} scored ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the two grounds are genuinely distinct themes, not a naive inversion", () => {
    expect(LIGHT.paper).not.toBe(DARK.paper);
    expect(LIGHT["v-ok"]).not.toBe(DARK["v-ok"]);
  });
});

describe("verdict encoding survives greyscale", () => {
  it("uses four distinct border styles, not colour alone", () => {
    const kinds = ["ok", "bad", "unknown", "sim"].map((c) => {
      const m = new RegExp(`\\.verdict\\.${c}\\{[^}]*border:([^;}]*)`, "u").exec(BASE_CSS)![1]!;
      return /(solid|double|dashed|dotted)/u.exec(m)![1]!;
    });
    expect(new Set(kinds).size).toBe(4);
  });
});

describe("page shell", () => {
  const html = page({
    title: "T",
    description: "D",
    section: "reprod",
    meta: "M",
    nav: [{ label: "A", href: "#", current: true }],
    body: "<section><h1>hi</h1></section>",
  });

  it("emits a complete document with a viewport meta", () => {
    expect(html).toMatch(/^<!doctype html>/u);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('content="width=device-width,initial-scale=1"');
  });

  it("declares the paper scheme", () => {
    expect(html).toContain('name="color-scheme" content="light"');
  });

  it("marks the current nav item for assistive tech", () => {
    expect(html).toContain('aria-current="page"');
  });

  it("ships the reduced-motion block", () => {
    expect(html).toMatch(/prefers-reduced-motion:\s*reduce/u);
  });

  it("keeps wide content in its own scroll container", () => {
    expect(html).toMatch(/\.tablewrap\{overflow-x:auto/u);
  });
});

describe("helpers", () => {
  it("escapes every HTML-significant character", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("escaping is applied to untrusted values in the shell", () => {
    const html = page({
      title: "<script>bad()</script>",
      description: "d",
      section: "s",
      meta: "m",
      nav: [],
      body: "",
    });
    expect(html).not.toContain("<script>bad()");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shortens long hashes but leaves short strings alone", () => {
    const long = `0x${"a".repeat(64)}`;
    expect(short(long, 10)).toBe("0xaaaaaaaa…aaaa");
    expect(short("0xabc", 10)).toBe("0xabc");
  });

  it("marker renders four corner crosses", () => {
    expect(marker("X").match(/aria-hidden="true">\+</gu)).toHaveLength(4);
  });

  it("stat escapes its inputs", () => {
    expect(stat("<k>", "<v>", "<n>")).not.toContain("<k>");
  });
});
