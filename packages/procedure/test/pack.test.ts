import { describe, it, expect } from "vitest";
import {
  canonical,
  packHash,
  PackRecorder,
  PackReader,
  envelope,
  type EvidencePack,
} from "../src/pack.js";

const meta = {
  procedureId: "CV-1",
  network: { name: "flare", chainId: 14 },
  anchors: { flareBlock: 66_671_978, xrplLedger: 106_065_390, skewSeconds: 2 },
} as const;

const build = (fill: (r: PackRecorder) => void): EvidencePack => {
  const r = new PackRecorder();
  fill(r);
  return r.build(meta);
};

describe("canonical form", () => {
  it("is independent of key insertion order", () => {
    // Two runners building the same facts in different order must hash the
    // same, or they would disagree about nothing at all.
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(canonical({ x: { q: 1, p: 2 } })).toBe(canonical({ x: { p: 2, q: 1 } }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it("renders bigints as decimal strings rather than losing them", () => {
    // A uint256 does not survive JSON.stringify as a number.
    expect(canonical({ v: 140_000_000_000_000n })).toBe('{"v":"140000000000000"}');
  });

  it("emits no insignificant whitespace", () => {
    expect(canonical({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });
});

describe("packHash", () => {
  it("is stable across identical packs", () => {
    const a = build((r) => r.record("flare.eth_call", { to: "0xabc" }, "0x1"));
    const b = build((r) => r.record("flare.eth_call", { to: "0xabc" }, "0x1"));
    expect(packHash(a)).toBe(packHash(b));
  });

  it("changes when any recorded answer changes", () => {
    const a = build((r) => r.record("flare.eth_call", { to: "0xabc" }, "0x1"));
    const b = build((r) => r.record("flare.eth_call", { to: "0xabc" }, "0x2"));
    expect(packHash(a)).not.toBe(packHash(b));
  });

  it("changes when the anchors change — a pack means nothing without its heights", () => {
    const r = new PackRecorder();
    r.record("flare.eth_call", { to: "0xabc" }, "0x1");
    const atA = r.build(meta);
    const atB = r.build({ ...meta, anchors: { ...meta.anchors, flareBlock: 1 } });
    expect(packHash(atA)).not.toBe(packHash(atB));
  });

  it("is a full 256-bit address, not a 32-bit comparator", () => {
    const h = packHash(build((r) => r.record("m", {}, 1)));
    expect(h).toMatch(/^0x[0-9a-f]{64}$/u);
  });
});

describe("call order does not leak into the pack", () => {
  it("two runners recording the same facts in different order agree", () => {
    // Promise.all resolves in arbitrary order. If that reached the hash, two
    // honest mirrors would disagree because of scheduling.
    const a = build((r) => {
      r.record("xrpl.account_info", { a: 1 }, "A");
      r.record("flare.eth_call", { b: 2 }, "B");
    });
    const b = build((r) => {
      r.record("flare.eth_call", { b: 2 }, "B");
      r.record("xrpl.account_info", { a: 1 }, "A");
    });
    expect(packHash(a)).toBe(packHash(b));
  });
});

describe("PackReader", () => {
  const pack = build((r) => {
    r.record("flare.eth_call", { to: "0xabc", data: "0xf0ec77fa" }, "0x7f");
    r.record("xrpl.account_objects", { account: "rVault", ledger_index: 106_065_390 }, { n: 14 });
  });

  it("replays a recorded answer offline", () => {
    const rd = new PackReader(pack);
    expect(rd.get("flare.eth_call", { to: "0xabc", data: "0xf0ec77fa" })).toBe("0x7f");
  });

  it("matches regardless of param key order", () => {
    const rd = new PackReader(pack);
    expect(rd.get("flare.eth_call", { data: "0xf0ec77fa", to: "0xabc" })).toBe("0x7f");
  });

  it("THROWS on a missing read rather than returning undefined", () => {
    // Proceeding with missing evidence would produce a confident opinion about
    // facts the procedure never saw. That is the failure this module exists to
    // make impossible, so it must be loud.
    const rd = new PackReader(pack);
    expect(() => rd.get("flare.eth_call", { to: "0xdead" })).toThrow(/no recorded answer/u);
  });

  it("names the pack and the call in the error, so the mismatch is diagnosable", () => {
    const rd = new PackReader(pack);
    expect(() => rd.get("xrpl.account_info", { account: "rOther" })).toThrow(/xrpl\.account_info/u);
  });

  it("exposes the anchors, because a verdict without heights is not re-derivable", () => {
    expect(new PackReader(pack).anchors.xrplLedger).toBe(106_065_390);
  });
});

describe("the envelope keeps metadata out of the hash", () => {
  it("capture time does not change the address", () => {
    // Otherwise the same evidence, captured twice, would be two different
    // packs — and nothing could ever be compared.
    const p = build((r) => r.record("m", {}, 1));
    const a = envelope(p, "2026-01-01T00:00:00.000Z");
    const b = envelope(p, "2026-08-05T12:00:00.000Z");
    expect(a.packHash).toBe(b.packHash);
    expect(a.capturedAt).not.toBe(b.capturedAt);
  });
});
