import { describe, it, expect } from "vitest";
import { validateFaultsFile, formatViolations, type SpecFile } from "../src/spec-validate.js";
import { FAULTS, KNOWN_UNCAUGHT } from "../src/faults.js";

/** Our own catalogue, rendered into the published format. */
const ours: SpecFile = {
  schema: "therecord.faults/v1",
  faults: FAULTS.map((f) => ({
    id: f.id,
    title: f.title,
    class: f.class,
    proves: f.proves,
    doesNotProve: f.doesNotProve,
    mustFire: f.mustFire,
    mustNotMove: f.mustNotMove,
  })),
  knownUncaught: KNOWN_UNCAUGHT.map((u) => ({ title: u.title, why: u.why })),
};

describe("we conform to the spec we published", () => {
  it("our own catalogue validates", () => {
    // Publishing a standard we do not meet would be the most embarrassing
    // possible entry in the errata.
    const v = validateFaultsFile(ours);
    expect(formatViolations(v)).toBe("valid — conforms to therecord.faults/v1");
  });

  it("every fault declares what it does NOT prove", () => {
    for (const f of FAULTS) expect(f.doesNotProve.length).toBeGreaterThan(20);
  });

  it("we ship a null fault, so our harness is not decorative", () => {
    expect(FAULTS.some((f) => f.class === "null")).toBe(true);
  });

  it("we ship a transport fault — the class most suites lack", () => {
    expect(FAULTS.some((f) => f.class === "transport")).toBe(true);
  });

  it("our knownUncaught is not empty", () => {
    expect(KNOWN_UNCAUGHT.length).toBeGreaterThan(0);
  });
});

describe("the validator rejects what the spec forbids", () => {
  const strip = (patch: (f: SpecFile) => SpecFile): SpecFile => patch(JSON.parse(JSON.stringify(ours)) as SpecFile);
  const ats = (f: SpecFile): string[] => validateFaultsFile(f).map((v) => v.at);

  it("rejects a missing mustNotMove — the untested false-positive half", () => {
    const f = strip((x) => {
      delete (x.faults as Array<Record<string, unknown>>)[1]!.mustNotMove;
      return x;
    });
    expect(ats(f)).toContain("faults[1].mustNotMove");
  });

  it("rejects an EMPTY mustNotMove, not just a missing one", () => {
    const f = strip((x) => {
      (x.faults as Array<Record<string, unknown>>)[1]!.mustNotMove = [];
      return x;
    });
    expect(ats(f)).toContain("faults[1].mustNotMove");
  });

  it("rejects a missing doesNotProve", () => {
    const f = strip((x) => {
      delete (x.faults as Array<Record<string, unknown>>)[2]!.doesNotProve;
      return x;
    });
    expect(ats(f)).toContain("faults[2].doesNotProve");
  });

  it("rejects an empty knownUncaught — a suite measuring its own imagination", () => {
    const f = strip((x) => ({ ...x, knownUncaught: [] }));
    expect(ats(f)).toContain("knownUncaught");
  });

  it("rejects a catalogue with no null fault", () => {
    const f = strip((x) => ({
      ...x,
      faults: (x.faults as Array<{ class?: string }>).filter((y) => y.class !== "null"),
    }));
    expect(ats(f)).toContain("faults");
  });

  it("rejects a control listed as both firing and not moving", () => {
    const f = strip((x) => {
      const one = (x.faults as Array<Record<string, unknown>>)[1]!;
      one.mustNotMove = [...(one.mustFire as string[])];
      return x;
    });
    expect(validateFaultsFile(f).some((v) => /both mustFire and mustNotMove/u.test(v.problem))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const f = strip((x) => {
      const arr = x.faults as Array<Record<string, unknown>>;
      arr[1]!.id = arr[0]!.id;
      return x;
    });
    expect(validateFaultsFile(f).some((v) => /duplicate id/u.test(v.problem))).toBe(true);
  });

  it("rejects an unknown schema rather than guessing", () => {
    expect(ats(strip((x) => ({ ...x, schema: "something/v9" })))).toContain("schema");
  });

  it("rejects an unknown fault class", () => {
    const f = strip((x) => {
      (x.faults as Array<Record<string, unknown>>)[0]!.class = "vibes";
      return x;
    });
    expect(ats(f)).toContain("faults[0].class");
  });

  it("rejects an empty faults array outright", () => {
    expect(ats({ schema: "therecord.faults/v1", faults: [], knownUncaught: [] })).toContain("faults");
  });
});

describe("violations teach, not just reject", () => {
  it("every violation says WHY the rule exists", () => {
    const v = validateFaultsFile({ schema: "wrong", faults: [], knownUncaught: [] });
    for (const x of v) expect(x.because.length).toBeGreaterThan(30);
  });

  it("reports every violation, not just the first", () => {
    const broken: SpecFile = {
      schema: "nope",
      faults: [{ id: "A", class: "vibes", proves: "x", mustFire: [], mustNotMove: [] }],
      knownUncaught: [],
    };
    expect(validateFaultsFile(broken).length).toBeGreaterThan(3);
  });
});
