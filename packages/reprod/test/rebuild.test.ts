import { describe, it, expect } from "vitest";
import type { RebuildOutcome } from "../src/rebuild.js";

/**
 * The vocabulary is the contract.
 *
 * REPRODUCED must mean "matches the code hash a machine is actually registered
 * with". DETERMINISTIC only means "builds the same way twice on this host".
 * A register that conflates them claims verification it never performed, so
 * the type is asserted structurally here — REPRODUCED cannot exist without an
 * `expected` to have matched against.
 */
describe("rebuild outcome vocabulary", () => {
  it("REPRODUCED carries the on-chain hash it matched", () => {
    const o: RebuildOutcome = { status: "REPRODUCED", digest: "0xaa", expected: "0xaa" };
    // @ts-expect-error — REPRODUCED without `expected` must not typecheck
    const bad: RebuildOutcome = { status: "REPRODUCED", digest: "0xaa" };
    expect(o.expected).toBe(o.digest);
    expect(bad).toBeTruthy();
  });

  it("DETERMINISTIC deliberately has no `expected` field", () => {
    const o: RebuildOutcome = { status: "DETERMINISTIC", digest: "0xaa" };
    expect(o).not.toHaveProperty("expected");
  });

  it("DIVERGED records both sides so the diff is attributable", () => {
    const o: RebuildOutcome = { status: "DIVERGED", digest: "0xaa", expected: "0xbb" };
    expect(o.digest).not.toBe(o.expected);
  });

  it("UNREPRODUCIBLE reports the disagreeing digests", () => {
    const o: RebuildOutcome = {
      status: "UNREPRODUCIBLE",
      reason: "two builds disagreed",
      digests: ["0xaa", "0xbb"],
    };
    expect(o.digests).toHaveLength(2);
    expect(new Set(o.digests).size).toBe(2);
  });

  it("only REPRODUCED may be treated as verification of a running machine", () => {
    const verified = (o: RebuildOutcome): boolean => o.status === "REPRODUCED";
    expect(verified({ status: "REPRODUCED", digest: "0xa", expected: "0xa" })).toBe(true);
    expect(verified({ status: "DETERMINISTIC", digest: "0xa" })).toBe(false);
    expect(verified({ status: "DIVERGED", digest: "0xa", expected: "0xb" })).toBe(false);
    expect(verified({ status: "UNREPRODUCIBLE", reason: "x" })).toBe(false);
    expect(verified({ status: "ERROR", reason: "x" })).toBe(false);
  });
});

/**
 * Observed on this machine, 2026-08-04: flare-foundation/tee-node@v0.0.24
 * built twice with --no-cache on the docker-container driver produced an
 * identical OCI image config digest both times, in 232s.
 */
describe("recorded evidence — tee-node v0.0.24", () => {
  const DIGEST = "0x7b096a01a1974dbcb0598b51b9de67f35b36c201e2ff65bbf5078b0785dc35bb";

  it("is a well-formed 32-byte digest", () => {
    expect(DIGEST).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("is recorded as DETERMINISTIC, not REPRODUCED — no chain hash was compared", () => {
    const o: RebuildOutcome = { status: "DETERMINISTIC", digest: DIGEST };
    expect(o.status).toBe("DETERMINISTIC");
  });
});
