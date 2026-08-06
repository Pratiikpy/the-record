import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  classifyReading,
  adjudicateBacking,
  rollUpFleet,
  type AgentReading,
} from "../src/agents.js";

const read = (flare: bigint, ledger: bigint | null): AgentReading => ({
  flareUnderlyingUBA: flare,
  onLedgerUBA: ledger,
  flareBlock: 66_748_252n,
  xrplLedger: ledger === null ? null : 106_099_993,
});

describe("a single reading cannot accuse", () => {
  it("calls a shortfall a CANDIDATE, never an exception", () => {
    expect(classifyReading(read(408_410_888_423n, 394_344_370_000n))).toBe("CANDIDATE");
  });

  it("a candidate on its own adjudicates to DISCLAIMER", () => {
    // REGRESSION — the live measurement. Reading both chains once, this agent
    // looked 14,066 XRP short. It was not: it had paid a redemption on the XRP
    // Ledger that Flare had not yet recorded. One sample is not a bracket.
    const v = adjudicateBacking([read(408_410_888_423n, 394_344_370_000n)]);
    expect(v.opinion).toBe("DISCLAIMER");
    expect(v.because).toMatch(/single cross-chain observation/u);
  });

  it("more on the ledger than Flare records is BACKED", () => {
    expect(classifyReading(read(393_423_100_000n, 394_344_370_000n))).toBe("BACKED");
  });

  it("an unreadable address is UNREADABLE, not a shortfall", () => {
    // A failed read once rendered as "this agent has no XRP account at all" —
    // a network error presented as a fact about someone else's solvency.
    expect(classifyReading(read(147_071_114_536n, null))).toBe("UNREADABLE");
  });
});

describe("the settle bracket", () => {
  it("REGRESSION: the real mainnet sequence resolves, and is never an EXCEPTION", () => {
    // t1 short by 14,066.52 XRP; t2 forty-five seconds later, over-backed by
    // 921.27 — because Flare fell by exactly the 14,987.784 XRP the agent had
    // already paid at XRP Ledger 106,099,993.
    const v = adjudicateBacking([
      read(408_410_888_423n, 394_344_370_000n),
      read(393_423_100_000n, 394_344_370_000n),
    ]);
    expect(v.opinion).toBe("DISCLAIMER");
    expect(v.because).toMatch(/did not persist/u);
  });

  it("confirms a shortfall that survives every height", () => {
    const v = adjudicateBacking([
      read(500_000_000_000n, 400_000_000_000n),
      read(500_000_000_000n, 400_000_000_000n),
      read(500_000_000_000n, 400_000_000_000n),
    ]);
    expect(v.opinion).toBe("EXCEPTION");
    expect(v.differenceUBA).toBe(-100_000_000_000n);
  });

  it("a single backed reading anywhere clears the candidate", () => {
    // The difference between a finding and a libel.
    const v = adjudicateBacking([
      read(500_000_000_000n, 400_000_000_000n),
      read(400_000_000_000n, 400_000_000_000n),
      read(500_000_000_000n, 400_000_000_000n),
    ]);
    expect(v.opinion).toBe("DISCLAIMER");
  });

  it("all-clean stays CLEAN", () => {
    const v = adjudicateBacking([
      read(348_375_580_610n, 348_506_869_267n),
      read(348_375_580_610n, 348_506_869_267n),
    ]);
    expect(v.opinion).toBe("CLEAN");
  });

  it("a wholly unreadable bracket is a DISCLAIMER, not a pass", () => {
    const v = adjudicateBacking([read(1n, null), read(1n, null)]);
    expect(v.opinion).toBe("DISCLAIMER");
    expect(v.differenceUBA).toBeNull();
  });

  it("no reading at all is a DISCLAIMER", () => {
    expect(adjudicateBacking([]).opinion).toBe("DISCLAIMER");
  });

  it("the control CAN fire — otherwise it is decoration", () => {
    // A backing control that has never returned EXCEPTION for any input is
    // indistinguishable from one that cannot. This is the proof that it can.
    const fired = adjudicateBacking([
      read(1_000n, 1n),
      read(1_000n, 1n),
    ]);
    expect(fired.opinion).toBe("EXCEPTION");
  });
});

describe("the fleet roll-up", () => {
  const v = (opinion: "CLEAN" | "EXCEPTION" | "DISCLAIMER") =>
    ({ opinion, differenceUBA: 0n, because: "" }) as const;

  it("one exception dominates", () => {
    expect(rollUpFleet([v("CLEAN"), v("EXCEPTION"), v("CLEAN")])).toBe("EXCEPTION");
  });

  it("a disclaimer never rounds up to a pass", () => {
    expect(rollUpFleet([v("CLEAN"), v("DISCLAIMER")])).toBe("DISCLAIMER");
  });

  it("an exception outranks a disclaimer", () => {
    expect(rollUpFleet([v("DISCLAIMER"), v("EXCEPTION")])).toBe("EXCEPTION");
  });

  it("all clean is CLEAN", () => {
    expect(rollUpFleet([v("CLEAN"), v("CLEAN")])).toBe("CLEAN");
  });

  it("an empty fleet is not CLEAN", () => {
    expect(rollUpFleet([])).toBe("DISCLAIMER");
  });
});

/**
 * The falsification evidence must be real.
 *
 * A tier is a claim like any other, and V3 is the strongest one this project
 * makes about itself. It is worth exactly as much as the artefact behind it, so
 * these assert the shape of that artefact rather than trusting that a file
 * called `agents-fork-red.json` means what its name suggests.
 */
describe("the AB-1 red run evidence", () => {
  const RED = join(dirname(fileURLToPath(import.meta.url)), "..", "out", "agents-fork-red.json");

  it("exists, or there is no V3 claim to make", () => {
    expect(existsSync(RED), "run `pnpm --filter @therecord/procedure agents:redrun` first").toBe(true);
  });

  it("records a green run that was CLEAN and a red run that was EXCEPTION", () => {
    const r = JSON.parse(readFileSync(RED, "utf8")) as {
      green: { opinion: string };
      red: { opinion: string };
      fired: boolean;
    };
    expect(r.green.opinion).toBe("CLEAN");
    expect(r.red.opinion).toBe("EXCEPTION");
    expect(r.fired).toBe(true);
  });

  it("moved the Flare side only, so the XRP Ledger cannot have caused the exception", () => {
    // If the fault had moved both sides the control could be comparing a number
    // to itself, which is E-003 exactly.
    const r = JSON.parse(readFileSync(RED, "utf8")) as {
      fault: { field: string; from: string; to: string };
    };
    expect(r.fault.field).toBe("underlyingBalanceUBA");
    expect(BigInt(r.fault.to)).toBeGreaterThan(BigInt(r.fault.from));
  });

  it("names the exact storage field it corrupted, so the run can be repeated", () => {
    const r = JSON.parse(readFileSync(RED, "utf8")) as {
      slot: string;
      field: { offset: number; width: number };
    };
    expect(r.slot).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(r.field.width).toBeGreaterThan(0);
    expect(r.field.offset + r.field.width).toBeLessThanOrEqual(256);
  });
});
