import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import { classifyAttestation, assessUrl, severity, type Attestation } from "../src/verdict.js";
import { bytes32ToString, statusName } from "../src/chain.js";

/** Real values observed on Coston2 at block 33,607,661. */
const SIMULATED_HASH = "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2";
const REAL_HASH = "0x5076a65e61e28a6f1660bd96b4df44d561cc27eaaeec30f17b09dc61c32730d1";
const P_TEST: Hex = "0x544553545f504c4154464f524d00000000000000000000000000000000000000";
const P_SEV: Hex = "0x4743505f414d445f534556000000000000000000000000000000000000000000";
const P_TDX: Hex = "0x4743505f494e54454c5f54445800000000000000000000000000000000000000";
const P_EMPTY: Hex = `0x${"00".repeat(32)}`;

describe("bytes32ToString", () => {
  it("decodes the four live platform strings", () => {
    expect(bytes32ToString(P_TEST)).toBe("TEST_PLATFORM");
    expect(bytes32ToString(P_SEV)).toBe("GCP_AMD_SEV");
    expect(bytes32ToString(P_TDX)).toBe("GCP_INTEL_TDX");
    expect(
      bytes32ToString("0x4743505f414d445f5345565f4553000000000000000000000000000000000000"),
    ).toBe("GCP_AMD_SEV_ES");
  });

  it("returns empty string for an all-zero word", () => {
    expect(bytes32ToString(P_EMPTY)).toBe("");
  });

  it("does not truncate on an interior zero-ish byte pattern", () => {
    // "AB" then padding — must not eat the B
    expect(bytes32ToString(`0x4142${"00".repeat(30)}`)).toBe("AB");
  });
});

describe("classifyAttestation", () => {
  it("flags TEST_PLATFORM as SIMULATED even with an unknown code hash", () => {
    expect(classifyAttestation({ codeHash: REAL_HASH, platformRaw: P_TEST })).toBe("SIMULATED");
  });

  it("flags the known simulated code hash as SIMULATED even on real hardware", () => {
    // Defence in depth: either signal alone is sufficient.
    expect(classifyAttestation({ codeHash: SIMULATED_HASH, platformRaw: P_SEV })).toBe("SIMULATED");
  });

  it("flags an empty platform as SIMULATED", () => {
    expect(classifyAttestation({ codeHash: REAL_HASH, platformRaw: P_EMPTY })).toBe("SIMULATED");
  });

  it("is NO_KNOWN_SOURCE for real hardware with no source claim", () => {
    expect(classifyAttestation({ codeHash: REAL_HASH, platformRaw: P_SEV })).toBe("NO_KNOWN_SOURCE");
  });

  it("is NO_KNOWN_SOURCE when a claim exists but was never rebuilt", () => {
    expect(
      classifyAttestation({
        codeHash: REAL_HASH,
        platformRaw: P_SEV,
        claim: { repo: "o/r", commitSha: "abc" },
      }),
    ).toBe("NO_KNOWN_SOURCE");
  });

  it("is UNREPRODUCIBLE when the rebuild was non-deterministic", () => {
    expect(
      classifyAttestation({
        codeHash: REAL_HASH,
        platformRaw: P_SEV,
        claim: { repo: "o/r", commitSha: "abc", rebuild: { digest: REAL_HASH, deterministic: false } },
      }),
    ).toBe("UNREPRODUCIBLE");
  });

  it("is REPRODUCED when a deterministic rebuild matches", () => {
    expect(
      classifyAttestation({
        codeHash: REAL_HASH,
        platformRaw: P_SEV,
        claim: { repo: "o/r", commitSha: "abc", rebuild: { digest: REAL_HASH, deterministic: true } },
      }),
    ).toBe("REPRODUCED");
  });

  it("matches case-insensitively — digests differ in case across tools", () => {
    expect(
      classifyAttestation({
        codeHash: REAL_HASH.toUpperCase().replace("0X", "0x"),
        platformRaw: P_SEV,
        claim: { repo: "o/r", commitSha: "abc", rebuild: { digest: REAL_HASH, deterministic: true } },
      }),
    ).toBe("REPRODUCED");
  });

  it("is DIVERGED when a deterministic rebuild does not match", () => {
    expect(
      classifyAttestation({
        codeHash: REAL_HASH,
        platformRaw: P_SEV,
        claim: {
          repo: "o/r",
          commitSha: "abc",
          rebuild: { digest: `0x${"ff".repeat(32)}`, deterministic: true },
        },
      }),
    ).toBe("DIVERGED");
  });

  it("never reports REPRODUCED for a simulated machine, whatever the claim says", () => {
    // The simulated hash is a shared constant — it would 'reproduce' against
    // anything. This is the single most important invariant in the module.
    const v = classifyAttestation({
      codeHash: SIMULATED_HASH,
      platformRaw: P_TEST,
      claim: {
        repo: "o/r",
        commitSha: "abc",
        rebuild: { digest: SIMULATED_HASH, deterministic: true },
      },
    });
    expect(v).toBe("SIMULATED");
    expect(v).not.toBe("REPRODUCED");
  });
});

describe("assessUrl", () => {
  const cases: ReadonlyArray<readonly [string, boolean, boolean]> = [
    ["https://mixing-websites-scored-aqua.trycloudflare.com", true, false],
    ["https://bunkmate-hut-catwalk.ngrok-free.dev", true, false],
    ["https://fb5a-67-71-166-224.ngrok-free.app", true, false],
    ["https://redesigned-memory-7v5vq44wgwgq2pqp9-6674.app.github.dev", true, false],
    ["https://ext-proxy-production.up.railway.app", true, false],
    ["https://tee-proxy-coston2-1.flare.rocks", false, false],
    ["https://fce.endpx.cloud", false, false],
    ["http://34.171.57.122:6664", false, true],
    ["http://51.178.43.25:6674", false, true],
  ];

  for (const [url, ephemeral, insecure] of cases) {
    it(`${url} → ephemeral=${ephemeral} insecure=${insecure}`, () => {
      const a = assessUrl(url);
      expect(a.ephemeral).toBe(ephemeral);
      expect(a.insecure).toBe(insecure);
      if (ephemeral) expect(a.reason).toBeTruthy();
    });
  }

  it("does not treat a lookalike suffix as ephemeral", () => {
    expect(assessUrl("https://nottrycloudflare.com").ephemeral).toBe(false);
    expect(assessUrl("https://evil.com/trycloudflare.com").ephemeral).toBe(false);
  });

  it("degrades safely on an unparseable URL", () => {
    const a = assessUrl("not a url");
    expect(a.ephemeral).toBe(false);
    expect(a.insecure).toBe(false);
    expect(a.host).toBe("not a url");
  });
});

describe("severity", () => {
  const ALL: ReadonlyArray<Attestation> = [
    "DIVERGED",
    "UNREPRODUCIBLE",
    "NO_KNOWN_SOURCE",
    "REPRODUCED",
    "SIMULATED",
  ];

  it("ranks a live diverged machine as the most urgent state in the system", () => {
    const scored = ALL.flatMap((a) => [severity(a, "LIVE"), severity(a, "DEAD")]);
    expect(Math.min(...scored)).toBe(severity("DIVERGED", "LIVE"));
  });

  it("prefers live over dead within every attestation class", () => {
    for (const a of ALL) {
      expect(severity(a, "LIVE")).toBeLessThan(severity(a, "DEAD"));
    }
  });

  it("ranks every real-hardware verdict above SIMULATED", () => {
    // Regression guard. On Coston2, 215 of 223 machines are simulated; if
    // SIMULATED ever sorts above real hardware again, the only eight rows that
    // carry any weight get buried and the register becomes useless.
    const worstReal = Math.max(
      ...ALL.filter((a) => a !== "SIMULATED").flatMap((a) => [
        severity(a, "LIVE"),
        severity(a, "DEAD"),
      ]),
    );
    expect(worstReal).toBeLessThan(severity("SIMULATED", "LIVE"));
  });

  it("is a total order with no ties across the ten states", () => {
    const scored = ALL.flatMap((a) => [severity(a, "LIVE"), severity(a, "DEAD")]);
    expect(new Set(scored).size).toBe(scored.length);
  });

  it("never returns undefined for any reachable state", () => {
    for (const a of ALL) {
      for (const l of ["LIVE", "DEAD", "UNCHECKED"] as const) {
        expect(Number.isInteger(severity(a, l))).toBe(true);
      }
    }
  });
});

describe("statusName", () => {
  it("maps the documented machine states", () => {
    expect(statusName(0)).toBe("UNKNOWN");
    expect(statusName(1)).toBe("INITIALIZED");
    expect(statusName(2)).toBe("PRODUCTION");
  });

  it("does not silently swallow an unmapped enum value", () => {
    expect(statusName(99)).toBe("UNMAPPED_99");
  });
});
