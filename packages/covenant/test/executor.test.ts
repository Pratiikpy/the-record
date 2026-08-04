import { describe, it, expect } from "vitest";
import { keccak256, toHex, decodeAbiParameters } from "viem";
import {
  plan,
  buildRequestBody,
  encodeRequest,
  standardAddressHash,
  roundIdForTimestamp,
  toBytes32String,
  ATTESTATION_TYPE,
  SOURCE_ID_TESTXRP,
  FDC_EPOCH_SECONDS,
  FDC_ROUND_SECONDS,
  FDC_PROOF_WINDOW_SECONDS,
  type Obligation,
} from "../src/executor.js";

/** A real unresolved obligation from Coston2, request 41934742. */
const O: Obligation = {
  requestId: "41934742",
  agentVault: "0xd5dEFe2c6229a1d0Cd8b0E9C0e28C0Db9C0e2D64",
  redeemer: "0x0000000000000000000000000000000000001111",
  valueUBA: "10000000",
  executor: "0x0000000000000000000000000000000000002222",
  paymentAddress: "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p",
  firstUnderlyingBlock: "19473000",
  lastUnderlyingBlock: "19473915",
  lastUnderlyingTimestamp: "1785362406",
  paymentReference: `0x${"ab".repeat(32)}`,
};

const DEADLINE = Number(O.lastUnderlyingTimestamp);
const OURS = "0x0000000000000000000000000000000000002222" as const;

describe("FDC round arithmetic", () => {
  it("uses the documented epoch and 90s cadence", () => {
    expect(FDC_EPOCH_SECONDS).toBe(1_658_429_955);
    expect(FDC_ROUND_SECONDS).toBe(90);
  });

  it("maps a timestamp to its round", () => {
    expect(roundIdForTimestamp(FDC_EPOCH_SECONDS)).toBe(0);
    expect(roundIdForTimestamp(FDC_EPOCH_SECONDS + 89)).toBe(0);
    expect(roundIdForTimestamp(FDC_EPOCH_SECONDS + 90)).toBe(1);
    expect(roundIdForTimestamp(FDC_EPOCH_SECONDS + 900)).toBe(10);
  });
});

describe("bytes32 identifiers", () => {
  it("right-pads, as FDC expects", () => {
    expect(toBytes32String("testXRP")).toBe(SOURCE_ID_TESTXRP);
    expect(SOURCE_ID_TESTXRP).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(SOURCE_ID_TESTXRP.endsWith("00")).toBe(true);
  });

  it("encodes the attestation type name exactly", () => {
    expect(ATTESTATION_TYPE).toBe(toBytes32String("ReferencedPaymentNonexistence"));
    // 29 chars fits in 32 bytes; a typo lengthening it must throw, not truncate
    expect(() => toBytes32String("x".repeat(33))).toThrow(/bytes32/u);
  });
});

describe("standardAddressHash", () => {
  it("hashes the address STRING", () => {
    // A wrong hashing basis produces a request that can never match a real
    // payment — so the attestation would confirm "no payment" for one that
    // plainly happened. That is a false default, the worst possible output.
    expect(standardAddressHash(O.paymentAddress)).toBe(keccak256(toHex(O.paymentAddress)));
  });

  it("is sensitive to a single character", () => {
    const a = standardAddressHash("rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p");
    const b = standardAddressHash("rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1q");
    expect(a).not.toBe(b);
  });
});

describe("buildRequestBody", () => {
  const b = buildRequestBody(O);

  it("spans the obligation's real underlying block range", () => {
    expect(b.minimalBlockNumber).toBe(19_473_000n);
    expect(b.deadlineBlockNumber).toBe(19_473_915n);
    expect(b.deadlineTimestamp).toBe(BigInt(DEADLINE));
  });

  it("carries the full redemption value and its payment reference", () => {
    expect(b.amount).toBe(10_000_000n);
    expect(b.standardPaymentReference).toBe(O.paymentReference);
  });

  it("does NOT constrain source addresses", () => {
    // The agent may legitimately pay from any of its addresses. Constraining
    // the source would manufacture nonexistence for a payment that was made.
    expect(b.checkSourceAddresses).toBe(false);
    expect(b.sourceAddressesRoot).toBe(`0x${"0".repeat(64)}`);
  });
});

describe("encodeRequest", () => {
  it("round-trips through the ABI decoder", () => {
    const encoded = encodeRequest(buildRequestBody(O));
    const [type, source, mic, body] = decodeAbiParameters(
      [
        { name: "attestationType", type: "bytes32" },
        { name: "sourceId", type: "bytes32" },
        { name: "messageIntegrityCode", type: "bytes32" },
        {
          name: "requestBody",
          type: "tuple",
          components: [
            { name: "minimalBlockNumber", type: "uint64" },
            { name: "deadlineBlockNumber", type: "uint64" },
            { name: "deadlineTimestamp", type: "uint64" },
            { name: "destinationAddressHash", type: "bytes32" },
            { name: "amount", type: "uint256" },
            { name: "standardPaymentReference", type: "bytes32" },
            { name: "checkSourceAddresses", type: "bool" },
            { name: "sourceAddressesRoot", type: "bytes32" },
          ],
        },
      ],
      encoded,
    );
    expect(type).toBe(ATTESTATION_TYPE);
    expect(source).toBe(SOURCE_ID_TESTXRP);
    expect(mic).toBe(`0x${"0".repeat(64)}`);
    expect((body as { amount: bigint }).amount).toBe(10_000_000n);
  });

  it("leaves the integrity code zero for the verifier to fill", () => {
    // Inventing a MIC produces a request rejected at the DA layer with no
    // error surface — the exact silent failure the post-mortem tool explains.
    const encoded = encodeRequest(buildRequestBody(O));
    expect(encoded.slice(2).slice(128, 192)).toBe("0".repeat(64));
  });
});

describe("plan — blockers are stated, never assumed away", () => {
  it("is executable when due, in window, ours, and funded", () => {
    const p = plan(O, DEADLINE + 86_400, { ourAddress: OURS, hasFundedKey: true });
    expect(p.blocker).toBe("NONE");
    expect(p.abiEncodedRequest.length).toBeGreaterThan(2);
  });

  it("reports NOT_YET_DUE before the deadline", () => {
    const p = plan(O, DEADLINE - 1, { ourAddress: OURS, hasFundedKey: true });
    expect(p.blocker).toBe("NOT_YET_DUE");
  });

  it("reports PROOF_WINDOW_CLOSED past 14 days", () => {
    const p = plan(O, DEADLINE + FDC_PROOF_WINDOW_SECONDS + 1, {
      ourAddress: OURS,
      hasFundedKey: true,
    });
    expect(p.blocker).toBe("PROOF_WINDOW_CLOSED");
  });

  it("reports NOT_OUR_ROLE when no executor was named", () => {
    const p = plan(
      { ...O, executor: "0x0000000000000000000000000000000000000000" },
      DEADLINE + 100,
      { ourAddress: OURS, hasFundedKey: true },
    );
    expect(p.blocker).toBe("NOT_OUR_ROLE");
    expect(p.blockerDetail).toMatch(/only the redeemer or agent/u);
  });

  it("reports NOT_OUR_ROLE when someone else is the executor", () => {
    const p = plan(O, DEADLINE + 100, {
      ourAddress: "0x000000000000000000000000000000000000dEaD",
      hasFundedKey: true,
    });
    expect(p.blocker).toBe("NOT_OUR_ROLE");
  });

  it("reports NO_FUNDED_KEY rather than pretending it could execute", () => {
    const p = plan(O, DEADLINE + 100, { ourAddress: OURS });
    expect(p.blocker).toBe("NO_FUNDED_KEY");
    expect(p.blockerDetail).toMatch(/funded key/u);
  });

  it("still builds a complete request even when blocked", () => {
    // A proof we may not submit is still worth preparing — it can be handed to
    // whoever may submit it.
    const p = plan(O, DEADLINE + 100, { ourAddress: "0x000000000000000000000000000000000000dEaD" });
    expect(p.blocker).toBe("NOT_OUR_ROLE");
    expect(p.requestBody.amount).toBe(10_000_000n);
    expect(p.abiEncodedRequest.length).toBeGreaterThan(2);
  });

  it("names the exact claim function", () => {
    const p = plan(O, DEADLINE + 100, { ourAddress: OURS, hasFundedKey: true });
    expect(p.claimFunction).toContain("redemptionPaymentDefault");
  });

  it("blocker precedence puts timing before permissions", () => {
    // A not-yet-due obligation is not "not our role" — reporting the wrong
    // blocker would send someone chasing the wrong fix.
    const p = plan({ ...O, executor: "0x0000000000000000000000000000000000000000" }, DEADLINE - 1);
    expect(p.blocker).toBe("NOT_YET_DUE");
  });
});
