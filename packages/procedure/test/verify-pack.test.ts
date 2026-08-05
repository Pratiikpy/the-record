import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyPack } from "../src/verify-pack.js";
import { packHash, type PackEnvelope } from "../src/pack.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, "..", "out", "packs");

const packs = existsSync(PACKS)
  ? readdirSync(PACKS)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(PACKS, f), "utf8")) as PackEnvelope)
  : [];

/**
 * The offline claim, enforced rather than asserted.
 *
 * `verify` prints "no network was contacted". A message is not evidence. Every
 * test here runs with fetch replaced by a throwing stub, so an edit that
 * quietly reintroduces a live read fails the build instead of passing for the
 * wrong reason — the same discipline as the red run, applied to a claim about
 * the verifier itself rather than about a control.
 */
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("NETWORK ACCESS during offline verification");
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("offline verification", () => {
  it("has at least one captured pack to verify", () => {
    // If this fails the suite below is vacuous — the exact "everything passes
    // because nothing is tested" failure this project keeps finding.
    expect(packs.length).toBeGreaterThan(0);
  });

  it.each(packs.map((p, i) => [p.packHash.slice(0, 14), i] as const))(
    "re-derives %s with fetch disabled",
    (_h, i) => {
      const r = verifyPack(packs[i]!);
      expect(r.addressIntact).toBe(true);
      expect(["CLEAN", "EXCEPTION", "DISCLAIMER"]).toContain(r.report.opinion);
    },
  );

  it("reproduces the opinion that was published from the live run", () => {
    const env = packs[0]!;
    expect(verifyPack(env).report.opinion).toBe("CLEAN");
  });

  it("is deterministic — two verifications of one pack agree exactly", () => {
    const env = packs[0]!;
    const a = verifyPack(env);
    const b = verifyPack(env);
    expect(a.report.evidence.evidenceDigest).toBe(b.report.evidence.evidenceDigest);
    expect(a.report.controls.map((c) => c.opinion)).toEqual(b.report.controls.map((c) => c.opinion));
  });
});

describe("tamper detection", () => {
  it("REPORTS a mismatch when a recorded answer is altered", () => {
    const env = packs[0]!;
    const tampered: PackEnvelope = {
      ...env,
      pack: {
        ...env.pack,
        reads: env.pack.reads.map((r) =>
          r.method === "flare.escrowedFunds" ? { ...r, result: "1" } : r,
        ),
      },
    };
    const r = verifyPack(tampered);
    expect(r.addressIntact).toBe(false);
    expect(r.packHash).not.toBe(env.packHash);
  });

  it("the altered evidence also changes the VERDICT, not just the hash", () => {
    // A tamper check that only notices the address would miss the thing that
    // matters: the opinion computed from false evidence.
    const env = packs[0]!;
    const tampered: PackEnvelope = {
      ...env,
      pack: {
        ...env.pack,
        reads: env.pack.reads.map((r) =>
          r.method === "flare.escrowedFunds" ? { ...r, result: "999999999999999" } : r,
        ),
      },
    };
    expect(verifyPack(tampered).report.opinion).toBe("EXCEPTION");
  });

  it("changing the anchors changes the address — heights are part of the evidence", () => {
    const env = packs[0]!;
    const moved = { ...env.pack, anchors: { ...env.pack.anchors, flareBlock: 1 } };
    expect(packHash(moved)).not.toBe(env.packHash);
  });
});

describe("incomplete evidence", () => {
  it("THROWS rather than concluding when a read is missing", () => {
    // Silently proceeding would produce a confident opinion about facts the
    // procedure never saw.
    const env = packs[0]!;
    const gutted: PackEnvelope = {
      ...env,
      pack: { ...env.pack, reads: env.pack.reads.filter((r) => r.method !== "xrpl.accountLedgerState") },
    };
    expect(() => verifyPack(gutted)).toThrow(/no recorded answer/u);
  });
});
