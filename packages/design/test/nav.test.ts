import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { navFor, hrefFromIndex, labelOf, REGISTERS } from "../src/nav.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

/**
 * Link integrity.
 *
 * Every renderer used to hand-write its own nav, and every page ended up
 * pointing at least one sibling at "#". Dead links are the cheapest possible
 * way to make a set of registers read as three unfinished demos rather than one
 * system, and nothing in a type checker catches them.
 */
describe("navFor", () => {
  it("offers every register from every register", () => {
    for (const from of REGISTERS) {
      const nav = navFor(from);
      expect(nav).toHaveLength(REGISTERS.length);
      expect(new Set(nav.map((n) => n.label)).size).toBe(REGISTERS.length);
    }
  });

  it("marks exactly one entry current, and it is the page itself", () => {
    for (const from of REGISTERS) {
      const nav = navFor(from);
      const current = nav.filter((n) => n.current);
      expect(current).toHaveLength(1);
      expect(current[0]!.label).toBe(labelOf(from));
    }
  });

  it("never emits a placeholder href", () => {
    // The actual bug: siblings linked to "#".
    for (const from of REGISTERS) {
      for (const n of navFor(from)) {
        expect(n.href, `${from} → ${n.label}`).not.toBe("#");
        expect(n.href.length).toBeGreaterThan(1);
      }
    }
  });

  it("links a register to itself with a self-relative path", () => {
    for (const from of REGISTERS) {
      const self = navFor(from).find((n) => n.current)!;
      expect(self.href).toBe("index.html");
    }
  });
});

describe("paths resolve on disk", () => {
  const pageOf = (r: (typeof REGISTERS)[number]): string =>
    join(ROOT, "packages", r, "out", "index.html");

  it("every register page has been built", () => {
    for (const r of REGISTERS) {
      expect(existsSync(pageOf(r)), `${r} page missing — run its build`).toBe(true);
    }
  });

  it("every cross-register link points at a real file", () => {
    for (const from of REGISTERS) {
      const dir = dirname(pageOf(from));
      for (const n of navFor(from)) {
        const target = resolve(dir, n.href);
        expect(existsSync(target), `${from} → ${n.label} (${n.href}) does not resolve`).toBe(true);
      }
    }
  });

  it("every link from the site index points at a real file", () => {
    const dir = join(ROOT, "site");
    for (const r of REGISTERS) {
      const target = resolve(dir, hrefFromIndex(r));
      expect(existsSync(target), `index → ${r} does not resolve`).toBe(true);
    }
  });

  it("the site index itself has been built", () => {
    expect(existsSync(join(ROOT, "site", "index.html"))).toBe(true);
  });
});
