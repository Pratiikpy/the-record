import { describe, it, expect } from "vitest";
import { keccak256, toHex } from "viem";
import { redemptionEvents, TERMINAL_EVENTS, ZERO_ADDRESS } from "../src/events.js";

/**
 * Topic0 lock.
 *
 * A wrong integer width in an indexed parameter changes the event selector, so
 * the indexer decodes ZERO of that event and silently reports every redemption
 * as still open. That exact bug shipped once here — RedemptionPerformed is
 * documented as `uint64 indexed requestId` and is `uint256` on chain.
 *
 * These hashes were counted directly out of Coston2 logs over 60,000 blocks.
 * If one changes, the ABI drifted and the scan is lying.
 */
const OBSERVED_ON_CHAIN: Record<string, string> = {
  RedemptionRequested: "0x8cbbd73a8d1b8b02a53c4c3b0ee34b472fe3099cc19bcfb57f1aae09e8a9847e",
  RedemptionPerformed: "0xd5150395b21c5be6cbb37ea167761efe7a013baccbd1bb7e5922fa261ccc3331",
};

function selector(ev: (typeof redemptionEvents)[number]): string {
  const args = ev.inputs.map((i) => i.type).join(",");
  return keccak256(toHex(`${ev.name}(${args})`));
}

describe("event selectors match what Coston2 actually emits", () => {
  for (const [name, topic0] of Object.entries(OBSERVED_ON_CHAIN)) {
    it(`${name} → ${topic0.slice(0, 12)}…`, () => {
      const ev = redemptionEvents.find((e) => e.name === name);
      expect(ev, `${name} missing from redemptionEvents`).toBeTruthy();
      expect(selector(ev!)).toBe(topic0);
    });
  }

  it("RedemptionPerformed uses uint256, not the documented uint64", () => {
    const ev = redemptionEvents.find((e) => e.name === "RedemptionPerformed")!;
    const requestId = ev.inputs.find((i) => i.name === "requestId")!;
    expect(requestId.type).toBe("uint256");
    expect(requestId.indexed).toBe(true);

    // Prove the documented form would have produced a selector that matches
    // nothing — this is the regression, stated as an assertion.
    const documented = keccak256(
      toHex("RedemptionPerformed(address,address,uint64,bytes32,uint256,int256)"),
    );
    expect(documented).not.toBe(OBSERVED_ON_CHAIN.RedemptionPerformed);
  });
});

describe("event definitions are internally consistent", () => {
  it("every event carries an indexed requestId", () => {
    for (const ev of redemptionEvents) {
      const r = ev.inputs.find((i) => i.name === "requestId");
      expect(r, `${ev.name} has no requestId`).toBeTruthy();
      expect(r!.indexed, `${ev.name}.requestId must be indexed to join on it`).toBe(true);
    }
  });

  it("uses a consistent requestId width across every event", () => {
    // Mixed widths still join (topics are padded to 32 bytes) but they decode
    // to different JS types, which is how key mismatches creep in.
    const widths = new Set(
      redemptionEvents.map((e) => e.inputs.find((i) => i.name === "requestId")!.type),
    );
    expect([...widths]).toEqual(["uint256"]);
  });

  it("every terminal event is defined", () => {
    const defined = new Set(redemptionEvents.map((e) => e.name));
    for (const t of TERMINAL_EVENTS) expect(defined.has(t), `${t} not defined`).toBe(true);
  });

  it("RedemptionRequested is not itself terminal", () => {
    expect((TERMINAL_EVENTS as readonly string[]).includes("RedemptionRequested")).toBe(false);
  });

  it("produces a distinct selector per event", () => {
    const sels = redemptionEvents.map(selector);
    expect(new Set(sels).size).toBe(sels.length);
  });

  it("ZERO_ADDRESS is the canonical 20-byte zero", () => {
    expect(ZERO_ADDRESS).toBe("0x0000000000000000000000000000000000000000");
    expect(ZERO_ADDRESS).toHaveLength(42);
  });
});
