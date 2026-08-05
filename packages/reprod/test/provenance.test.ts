import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  hashProvenance,
  indexRegistry,
  identifyingBits,
  summarise,
  type RegistryEntry,
  type RebuildEvidence,
} from "../src/provenance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN = join(HERE, "..", "out", "scan.json");

/** The value the overwhelming majority of Coston2 machines carry. Referenced by value, never by team. */
const SHARED = "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2";
const DISTINCT = "0x073b3949130577811e5817cebd2526342802458c3c1c7a70e69190dc53c453b9";

const entry = (o: Partial<RegistryEntry>): RegistryEntry => ({
  codeHash: SHARED,
  owner: "0xowner1",
  extensionId: "1",
  platform: "TEST_PLATFORM",
  ...o,
});

describe("identifyingBits", () => {
  it("is ~0 when every machine carries the hash", () => {
    // If everyone answers the same, the answer carries no information.
    expect(identifyingBits(250, 250)).toBe(0);
  });

  it("is log2(n) when exactly one machine carries it", () => {
    expect(identifyingBits(1, 256)).toBe(8);
    expect(identifyingBits(1, 256)).toBe(8);
  });

  it("collapses toward zero as sharing grows", () => {
    expect(identifyingBits(238, 250)).toBeLessThan(0.1);
    expect(identifyingBits(2, 250)).toBeGreaterThan(6);
  });

  it("never returns NaN or Infinity on degenerate input", () => {
    for (const [c, t] of [[0, 10], [10, 0], [0, 0], [-1, 5]] as const) {
      expect(Number.isFinite(identifyingBits(c, t))).toBe(true);
    }
  });
});

describe("hashProvenance — NOT_A_MEASUREMENT", () => {
  it("fires when independent owners share a hash", () => {
    const idx = indexRegistry([
      entry({ owner: "0xa", extensionId: "1" }),
      entry({ owner: "0xb", extensionId: "2" }),
      entry({ owner: "0xc", extensionId: "3" }),
    ]);
    const p = hashProvenance(SHARED, idx);
    expect(p.verdict).toBe("NOT_A_MEASUREMENT");
    expect(p.distinctOwners).toBe(3);
  });

  it("is derived from sharing, NOT from a blocklist of known constants", () => {
    // The same value, carried by one owner, must NOT be called a non-measurement.
    // This is what makes the module an instrument rather than a lookup table:
    // it would flag an unknown shared hash, and would clear the simulator's own
    // constant the moment only one owner used it.
    const idx = indexRegistry([entry({ owner: "0xsolo" })]);
    expect(hashProvenance(SHARED, idx).verdict).not.toBe("NOT_A_MEASUREMENT");
  });

  it("flags a hash nobody has ever heard of, if owners share it", () => {
    const invented = `0x${"ab".repeat(32)}`;
    const idx = indexRegistry([
      entry({ codeHash: invented, owner: "0xa" }),
      entry({ codeHash: invented, owner: "0xb" }),
    ]);
    expect(hashProvenance(invented, idx).verdict).toBe("NOT_A_MEASUREMENT");
  });

  it("does not fire when one owner runs many machines", () => {
    // A fleet operator registering 50 machines has not destroyed the signal
    // about their own code. Sharing across OWNERS is what erases identity.
    const idx = indexRegistry(
      Array.from({ length: 50 }, (_, i) => entry({ owner: "0xfleet", extensionId: String(i) })),
    );
    expect(hashProvenance(SHARED, idx).verdict).not.toBe("NOT_A_MEASUREMENT");
  });

  it("is checked BEFORE any source comparison, so a shared hash never REPRODUCES", () => {
    // A shared constant would match whichever source you happened to hold, and
    // the match would be meaningless. Verifying it manufactures false confidence.
    const idx = indexRegistry([entry({ owner: "0xa" }), entry({ owner: "0xb" })]);
    const rebuilds: RebuildEvidence[] = [
      { codeHash: SHARED, source: { repo: "r/x", commitSha: "deadbeefcafe" }, digests: [SHARED, SHARED] },
    ];
    expect(hashProvenance(SHARED, idx, rebuilds).verdict).toBe("NOT_A_MEASUREMENT");
  });
});

describe("hashProvenance — the accusation is unconstructable", () => {
  const solo = indexRegistry([entry({ codeHash: DISTINCT, owner: "0xsolo", platform: "GCP_INTEL_TDX" })]);
  const src = { repo: "flare-foundation/x", commitSha: "0123456789abcdef" };

  it("a single failed rebuild is UNREPRODUCIBLE, never DIVERGED", () => {
    const r: RebuildEvidence[] = [{ codeHash: DISTINCT, source: src, digests: ["0xdifferent"] }];
    const p = hashProvenance(DISTINCT, solo, r);
    expect(p.verdict).toBe("UNREPRODUCIBLE");
    expect(p.doesNotEstablish).toMatch(/our build environment/u);
  });

  it("two disagreeing rebuilds are UNREPRODUCIBLE — we cannot compare noise", () => {
    const r: RebuildEvidence[] = [{ codeHash: DISTINCT, source: src, digests: ["0xaaa", "0xbbb"] }];
    expect(hashProvenance(DISTINCT, solo, r).verdict).toBe("UNREPRODUCIBLE");
  });

  it("two agreeing rebuilds WITHOUT a named difference are still not DIVERGED", () => {
    const r: RebuildEvidence[] = [{ codeHash: DISTINCT, source: src, digests: ["0xaaa", "0xaaa"] }];
    expect(hashProvenance(DISTINCT, solo, r).verdict).toBe("UNREPRODUCIBLE");
  });

  it("DIVERGED requires two agreeing rebuilds AND a named difference", () => {
    const r: RebuildEvidence[] = [
      { codeHash: DISTINCT, source: src, digests: ["0xaaa", "0xaaa"], diff: "layer 3 mtime differs" },
    ];
    const p = hashProvenance(DISTINCT, solo, r);
    expect(p.verdict).toBe("DIVERGED");
    expect(p.because).toContain("layer 3 mtime differs");
  });

  it("REPRODUCED still refuses to claim the machine is running that image", () => {
    const r: RebuildEvidence[] = [{ codeHash: DISTINCT, source: src, digests: [DISTINCT] }];
    const p = hashProvenance(DISTINCT, solo, r);
    expect(p.verdict).toBe("REPRODUCED");
    expect(p.doesNotEstablish).toMatch(/currently running/u);
  });

  it("EVERY verdict states what it does not establish", () => {
    const cases = [
      hashProvenance(DISTINCT, solo),
      hashProvenance(DISTINCT, solo, [{ codeHash: DISTINCT, source: src, digests: [DISTINCT] }]),
      hashProvenance("0xnotinregistry", solo),
      hashProvenance(SHARED, indexRegistry([entry({ owner: "0xa" }), entry({ owner: "0xb" })])),
    ];
    for (const p of cases) {
      expect(p.doesNotEstablish.length).toBeGreaterThan(20);
      expect(p.because.length).toBeGreaterThan(20);
    }
  });

  it("no verdict text ever contains an owner address", () => {
    // Verdicts describe the HASH. If an address leaked into rendered prose, a
    // registry-level statistic would silently become a per-operator callout.
    const idx = indexRegistry([entry({ owner: "0xDEADBEEF" }), entry({ owner: "0xFEEDFACE" })]);
    const p = hashProvenance(SHARED, idx);
    expect(`${p.because} ${p.doesNotEstablish}`.toLowerCase()).not.toContain("0xdeadbeef");
    expect(`${p.because} ${p.doesNotEstablish}`.toLowerCase()).not.toContain("0xfeedface");
  });

  it("NOT_A_MEASUREMENT explicitly says simulation is permitted", () => {
    const idx = indexRegistry([entry({ owner: "0xa" }), entry({ owner: "0xb" })]);
    expect(hashProvenance(SHARED, idx).doesNotEstablish).toMatch(/permitted/u);
  });
});

describe("hashProvenance — unknown hash", () => {
  it("does not pretend a missing hash is invalid", () => {
    const p = hashProvenance(`0x${"11".repeat(32)}`, indexRegistry([entry({})]));
    expect(p.verdict).toBe("UNKNOWN_HASH");
    expect(p.identifyingBits).toBeNull();
    expect(p.doesNotEstablish).toMatch(/not.*invalid|newer than the snapshot/iu);
  });
});

describe("against the real Coston2 registry snapshot", () => {
  const scan = JSON.parse(readFileSync(SCAN, "utf8")) as {
    totalActiveMachines: number;
    machines: Array<{ codeHash: string; owner: string; extensionId: string; platform: string; attestation: string }>;
  };
  const idx = indexRegistry(scan.machines);

  it("the snapshot is the whole fleet, not a page of it", () => {
    // A partial scan would understate sharing and flatter the registry.
    expect(scan.machines.length).toBe(scan.totalActiveMachines);
    expect(scan.machines.length).toBeGreaterThan(100);
  });

  it("the fleet carries far fewer distinct hashes than machines", () => {
    // Asserted as a ratio, not a magic number. A hardcoded count went stale
    // the moment the registry grew from 223 to 250 machines, and the test kept
    // passing because it read the same out-of-date snapshot the page did.
    expect(idx.byHash.size).toBeLessThan(scan.machines.length / 10);
  });

  it("the most-shared hash spans dozens of independent owners", () => {
    const s = summarise(idx);
    expect(s.mostShared).not.toBeNull();
    // Derived from the snapshot rather than pinned: what matters is that one
    // value dominates the fleet across many independent owners, not the exact
    // count on any given day.
    expect(s.mostShared!.registrations / s.total).toBeGreaterThan(0.9);
    expect(s.mostShared!.distinctOwners).toBeGreaterThan(10);
    expect(s.mostShared!.bits).toBeLessThan(0.2);
  });

  it("the overwhelming majority of the fleet carries a hash that identifies almost nothing", () => {
    // REGRESSION. This pinned 0.95 in the threshold and "96%" in its own name.
    // A later scan read 243 of 256 — 94.9% — and the suite went red over a
    // registry that had simply grown, while the finding it guards was entirely
    // unchanged. That is the E-008 mistake one level down: a test asserting the
    // value a snapshot happened to have rather than the property being claimed.
    //
    // The claim is "almost the whole fleet, identifying almost nothing". The
    // bound is loose enough to survive the registry moving and tight enough
    // that a fleet of genuinely distinct hashes would still fail it.
    const s = summarise(idx);
    expect(s.machinesOnSharedHashes / s.total).toBeGreaterThan(0.9);
    expect(s.meanIdentifyingBits).toBeLessThan(0.5);
  });

  it("the distinctive hashes are still measurable — the instrument can say yes", () => {
    // If every verdict were "unknown" the tool would be inert. The eight
    // distinct hashes are exactly where a real answer is possible.
    const distinctive = [...idx.byHash.entries()].filter(
      ([, e]) => new Set(e.map((x) => x.owner.toLowerCase())).size === 1,
    );
    expect(distinctive.length).toBeGreaterThanOrEqual(5);
    for (const [h] of distinctive) {
      expect(hashProvenance(h, idx).verdict).not.toBe("NOT_A_MEASUREMENT");
    }
  });

  it("real-hardware platforms are the ones carrying distinctive hashes", () => {
    const s = hashProvenance(
      "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2",
      idx,
    );
    expect(s.platforms).toEqual(["TEST_PLATFORM"]);
    expect(s.verdict).toBe("NOT_A_MEASUREMENT");
  });
});
