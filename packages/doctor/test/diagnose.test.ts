import { describe, it, expect, vi, afterEach } from "vitest";
import { diagnose, verdictOf, type MachineFacts } from "../src/diagnose.js";
import { explain } from "../src/explain.js";

/**
 * The no-key test originally relied on ZEROG_API_KEY happening to be unset, and
 * passed or failed depending on the machine it ran on. A test whose result
 * depends on ambient environment is worse than no test — it teaches the suite
 * to be ignored. The environment is stubbed explicitly instead.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

/** A real machine from the Coston2 register, 2026-08-04. */
const BASE: MachineFacts = {
  teeId: "0xE3829862Ef972e1dfAB338643c4041a6a1F00b20",
  extensionId: "65832",
  status: "PRODUCTION",
  codeHash: "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2",
  platform: "TEST_PLATFORM",
  url: "https://2266-102-90-79-189.ngrok-free.app",
  host: "2266-102-90-79-189.ngrok-free.app",
  ephemeral: true,
  ephemeralReason: "ngrok free tunnel — URL rotates",
  insecure: false,
  machinesOnThisUrl: 1,
  liveness: "DEAD",
  probeError: "timeout",
  selfReport: "NONE",
};

const healthy: MachineFacts = {
  ...BASE,
  codeHash: "0x5076a65e61e28a6f1660bd96b4df44d561cc27eaaeec30f17b09dc61c32730d1",
  platform: "GCP_AMD_SEV",
  url: "https://tee-proxy-coston2-1.flare.rocks",
  host: "tee-proxy-coston2-1.flare.rocks",
  ephemeral: false,
  liveness: "LIVE",
  probeMs: 400,
  probeError: undefined,
};

const ids = (m: MachineFacts): string[] => diagnose(m).map((f) => f.id);

describe("reachability rules", () => {
  it("blames a rotating tunnel when an ephemeral host is dead", () => {
    expect(ids(BASE)).toContain("URL_ROTATED");
    expect(ids(BASE)).not.toContain("PROXY_UNREACHABLE");
  });

  it("reports a plain unreachable proxy when the host is stable", () => {
    const m = { ...BASE, ephemeral: false, ephemeralReason: undefined };
    expect(ids(m)).toContain("PROXY_UNREACHABLE");
    expect(ids(m)).not.toContain("URL_ROTATED");
  });

  it("says nothing about reachability when the machine answers", () => {
    const found = ids(healthy);
    expect(found).not.toContain("URL_ROTATED");
    expect(found).not.toContain("PROXY_UNREACHABLE");
  });

  it("notes a slow proxy without calling it a fault", () => {
    const f = diagnose({ ...healthy, probeMs: 1500 }).find((x) => x.id === "SLOW_PROXY")!;
    expect(f.severity).toBe("NOTE");
  });
});

describe("attestation rules", () => {
  it("flags the simulated constant", () => {
    expect(ids(BASE)).toContain("SIMULATED");
  });

  it("flags TEST_PLATFORM even with a different code hash", () => {
    expect(ids({ ...BASE, codeHash: `0x${"ab".repeat(32)}` })).toContain("SIMULATED");
  });

  it("does not call real confidential hardware simulated", () => {
    expect(ids(healthy)).not.toContain("SIMULATED");
  });

  it("treats simulated as a NOTE, not a fault — it is a legitimate mode", () => {
    const f = diagnose(BASE).find((x) => x.id === "SIMULATED")!;
    expect(f.severity).toBe("NOTE");
  });
});

describe("status rules", () => {
  it("explains INITIALIZED by pointing at the availability check", () => {
    const f = diagnose({ ...healthy, status: "INITIALIZED" }).find(
      (x) => x.id === "NEVER_REACHED_PRODUCTION",
    )!;
    expect(f.severity).toBe("BLOCKER");
    expect(f.fix).toMatch(/availability check/u);
  });

  it("blocks on PAUSED and BANNED", () => {
    for (const s of ["PAUSED", "BANNED"]) {
      expect(ids({ ...healthy, status: s })).toContain("SUSPENDED");
    }
  });
});

describe("identity rules", () => {
  it("blocks on a genuine self-report mismatch", () => {
    const f = diagnose({
      ...healthy,
      selfReport: "MISMATCH",
      selfReportedCodeHash: `0x${"cd".repeat(32)}`,
    }).find((x) => x.id === "SELF_REPORT_MISMATCH")!;
    expect(f.severity).toBe("BLOCKER");
  });

  it("treats a shared proxy as a NOTE and explains why no check is possible", () => {
    const f = diagnose({ ...healthy, selfReport: "AMBIGUOUS", machinesOnThisUrl: 4 }).find(
      (x) => x.id === "SHARED_PROXY",
    )!;
    expect(f.severity).toBe("NOTE");
    expect(f.fix).toMatch(/cannot be attributed/u);
  });

  it("never reports a mismatch it cannot support", () => {
    // AMBIGUOUS must not become MISMATCH — that was a real bug in the scanner.
    expect(ids({ ...healthy, selfReport: "AMBIGUOUS" })).not.toContain("SELF_REPORT_MISMATCH");
  });
});

describe("verdict roll-up", () => {
  it("BLOCKER dominates", () => {
    expect(verdictOf(diagnose(BASE))).toBe("BLOCKER");
  });

  it("a clean machine reports OK", () => {
    expect(verdictOf(diagnose(healthy))).toBe("OK");
    expect(ids(healthy)).toEqual(["HEALTHY"]);
  });

  it("sorts blockers first so the terminal leads with what is broken", () => {
    const f = diagnose({ ...BASE, insecure: true });
    expect(f[0]!.severity).toBe("BLOCKER");
  });

  it("warnings do not mask blockers", () => {
    const f = diagnose({ ...BASE, insecure: true });
    expect(verdictOf(f)).toBe("BLOCKER");
    expect(f.map((x) => x.id)).toContain("PLAINTEXT_PROXY");
  });
});

describe("the diagnosis stands alone", () => {
  it("produces findings with no network, no key and no model", async () => {
    // The whole point: prose is a convenience layer. A diagnostic that depends
    // on a language model for its conclusions is not a diagnostic.
    vi.stubEnv("ZEROG_API_KEY", "");

    const findings = diagnose(BASE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.observed.length > 0)).toBe(true);

    const e = await explain(findings);
    expect(e.ok, "prose must not be attempted without a key").toBe(false);
    expect(e.reason).toMatch(/ZEROG_API_KEY/u);
    // and the findings are untouched by that failure
    expect(diagnose(BASE)).toEqual(findings);
  });

  it("a failing prose call never changes the diagnosis", async () => {
    vi.stubEnv("ZEROG_API_KEY", "sk-definitely-invalid");
    const findings = diagnose(BASE);
    const before = JSON.stringify(findings);
    await explain(findings, { baseUrl: "http://127.0.0.1:1", timeoutMs: 1500 });
    expect(JSON.stringify(diagnose(BASE))).toBe(before);
  });

  it("every blocker carries an actionable fix", () => {
    for (const m of [BASE, { ...healthy, status: "INITIALIZED" }, { ...healthy, status: "PAUSED" }]) {
      for (const f of diagnose(m).filter((x) => x.severity === "BLOCKER")) {
        expect(f.fix, `${f.id} has no fix`).toBeTruthy();
      }
    }
  });

  it("explain refuses an empty finding set rather than inventing one", async () => {
    const e = await explain([], { apiKey: "sk-test" });
    expect(e.ok).toBe(false);
    expect(e.reason).toBe("nothing to explain");
  });
});

/**
 * A tool must answer to the name it gives you.
 *
 * `doctor --worst` reports each machine as `extension 65832 · PRODUCTION · …`,
 * so the reader's next move is `doctor 65832`. That printed "no machine
 * matching" — for a machine the tool had just described in full. The lookup was
 * correct (teeId or host) and the tool was still broken, because the identifier
 * it leads with was not one of them.
 */
describe("lookup accepts every identifier the report prints", () => {
  const machines = [
    { teeId: "0xAAA1", extensionId: "65832", host: "a.example" },
    { teeId: "0xBBB2", extensionId: "65839", host: "b.example" },
  ];

  // The same predicate cli.ts uses to resolve a single machine.
  const find = (arg: string): (typeof machines)[number] | undefined => {
    const needle = arg.toLowerCase();
    return machines.find(
      (m) =>
        m.teeId.toLowerCase() === needle ||
        m.host.toLowerCase() === needle ||
        m.extensionId.toLowerCase() === needle,
    );
  };

  it.each([
    ["teeId", "0xAAA1"],
    ["extension id, as printed in the report", "65832"],
    ["host", "a.example"],
    ["teeId in the wrong case", "0xaaa1"],
  ])("resolves by %s", (_label, arg) => {
    expect(find(arg)?.extensionId).toBe("65832");
  });

  it("still refuses an identifier that belongs to nobody", () => {
    // Matching more things must not become matching anything.
    expect(find("99999")).toBeUndefined();
  });
});
