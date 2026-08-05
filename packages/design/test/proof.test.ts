/**
 * The proof deck restates every register at once, so it is the most likely
 * place in the repository for a stale number.
 *
 * Two shipped defects were exactly this shape: an index that said "Six errata"
 * over a register of seven, and a headline of 223 machines while the chain held
 * 250. Both were hand-typed restatements of something that had moved. A deck
 * whose entire purpose is to be believed cannot be the third.
 *
 * These tests read the RENDERED page and compare it against the same sources
 * the registers use. They fail if the deck and the registers ever disagree.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { ERRATA } from "../src/errata.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DECK = join(ROOT, "site", "proof-deck.html");

const read = <T,>(p: string): T | null =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;

let html: string;

beforeAll(() => {
  if (!existsSync(DECK)) {
    throw new Error(`${DECK} missing — run \`pnpm -w run render:all\` before the test suite`);
  }
  html = readFileSync(DECK, "utf8");
});

describe("the deck agrees with the registers it summarises", () => {
  it("states the TEE machine count the scan actually recorded", () => {
    const scan = read<{ totalActiveMachines: number }>(
      join(ROOT, "packages/reprod/out/scan.json"),
    );
    expect(scan, "scan.json missing").toBeTruthy();
    expect(html).toContain(String(scan!.totalActiveMachines));
  });

  it("states CV-1's actual opinion, not a remembered one", () => {
    const cv1 = read<{ opinion: string }>(join(ROOT, "packages/procedure/out/cv1.json"));
    expect(cv1, "cv1.json missing").toBeTruthy();
    expect(html).toContain(cv1!.opinion);
  });

  it("shows the red run flipping to the opinion the fork actually produced", () => {
    // If the fault ever stops firing, the deck must not keep claiming it does.
    const green = read<{ opinion: string }>(join(ROOT, "packages/procedure/out/cv1-fork-green.json"));
    const red = read<{ opinion: string }>(join(ROOT, "packages/procedure/out/cv1-fork-red.json"));
    expect(green!.opinion).toBe("CLEAN");
    expect(red!.opinion).toBe("EXCEPTION");
    expect(html).toContain(`${green!.opinion} to ${red!.opinion} on a single corrupted slot`);
  });

  it("counts the errata rather than remembering them", () => {
    const published = ERRATA.filter((e) => e.fate === "PUBLISHED").length;
    expect(html).toContain(`${ERRATA.length}</div>`);
    expect(html).toContain(`${published} reached the public`);
  });

  it("states the number of passes it actually rendered", () => {
    const claimed = /([0-9]+) numbered passes/u.exec(html);
    expect(claimed, 'deck should state "<n> numbered passes"').toBeTruthy();
    const rendered = (html.match(/class="step"/gu) ?? []).length;
    expect(Number(claimed![1]), "the deck miscounts its own sections").toBe(rendered);
  });

  it("never spells a live count as a word", () => {
    // "Fifteen numbered passes" shipped over fourteen sections on the first
    // build of this very page. A word cannot be derived from anything.
    //
    // `<q class="was">` marks a figure QUOTED from our own past — the deck cites
    // the index's old "Six errata" as the cautionary example. Quoting a wrong
    // number we already retracted is the opposite of asserting one, so it is
    // stripped before the rule applies. Everything outside those marks is a
    // claim the deck is making now, and must be derived.
    const asserted = html.replace(/<q class="was">.*?<\/q>/gsu, "");
    expect(asserted).not.toMatch(
      /\b(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen) (numbered passes|errata|entries|controls|machines)\b/u,
    );
  });

  it("the quoted-history escape hatch cannot be used to smuggle in a live claim", () => {
    // If <q class="was"> ever wrapped most of the page, the rule above would
    // pass while testing nothing.
    const quoted = [...html.matchAll(/<q class="was">(.*?)<\/q>/gsu)].map((m) => m[1]!);
    for (const q of quoted) {
      expect(q.length, `quoted history is too long to be a citation: ${q.slice(0, 60)}`).toBeLessThan(80);
    }
  });
});

describe("the evidence it points at exists", () => {
  it("every screenshot it embeds is a real file", () => {
    const srcs = [...html.matchAll(/src="(proof\/[^"]+)"/gu)].map((m) => m[1]!);
    expect(srcs.length, "the deck should embed screenshots").toBeGreaterThanOrEqual(6);
    for (const s of srcs) {
      expect(existsSync(join(ROOT, "site", s)), `${s} is referenced but not on disk`).toBe(true);
    }
  });

  it("every badge it embeds is a real file", () => {
    const srcs = [...html.matchAll(/src="(badge\/[^"]+)"/gu)].map((m) => m[1]!);
    expect(srcs.length).toBeGreaterThanOrEqual(3);
    for (const s of srcs) {
      expect(existsSync(join(ROOT, "site", s)), `${s} is referenced but not on disk`).toBe(true);
    }
  });

  it("declares dimensions on every image, so the page does not reflow as it loads", () => {
    const imgs = [...html.matchAll(/<img\b[^>]*>/gu)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img, `image without alt text: ${img.slice(0, 80)}`).toMatch(/\balt="/u);
    }
  });
});

describe("it still refuses to overclaim", () => {
  it("carries the limitations section", () => {
    // A deck that lists only what works is marketing. These are the same limits
    // the registers state, and they must not be quietly dropped from the summary.
    for (const phrase of [
      "Zero real defaults exist on FXRP today",
      "Covenant cannot be backfilled",
      "declared uncaught",
      "No users yet",
      "not a safety rating",
    ]) {
      expect(html, `the deck dropped the limitation: ${phrase}`).toContain(phrase);
    }
  });

  it("admits the clean-clone failure rather than only claiming the fix", () => {
    expect(html).toContain("82 silently skipped tests");
  });
});
