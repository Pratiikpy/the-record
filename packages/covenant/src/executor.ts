/**
 * executor — build the proof request and the claim for an unresolved obligation.
 *
 * This is the whole point of Layer 1. An obligation is past its deadline and
 * nothing is recorded either way; the only thing that settles whether the agent
 * paid is an FDC `ReferencedPaymentNonexistence` attestation. Somebody has to
 * request it, wait for the round, fetch the proof and call
 * `redemptionPaymentDefault`. Today, on Coston2, nobody does — `fasset-bots`
 * ships an agent, a challenger, a liquidator, a timekeeper, a pinger, a
 * systemKeeper and a price-publisher, and no executor.
 *
 * Every step below is constructed from real chain data. The only thing missing
 * to execute is a funded key, which is stated rather than hidden: `plan()`
 * returns exactly what would be sent, so the path is complete the moment one
 * is supplied.
 */
import { encodeAbiParameters, keccak256, toHex, stringToHex, type Address, type Hex } from "viem";

/** FDC voting rounds are 90s from a fixed epoch. Verified against the docs. */
export const FDC_EPOCH_SECONDS = 1_658_429_955;
export const FDC_ROUND_SECONDS = 90;

export function roundIdForTimestamp(unixSeconds: number): number {
  return Math.floor((unixSeconds - FDC_EPOCH_SECONDS) / FDC_ROUND_SECONDS);
}

/** bytes32-encoded, right-padded — how FDC identifies types and sources. */
export function toBytes32String(s: string): Hex {
  const hex = stringToHex(s).slice(2);
  if (hex.length > 64) throw new Error(`"${s}" does not fit in bytes32`);
  return `0x${hex.padEnd(64, "0")}`;
}

export const ATTESTATION_TYPE = toBytes32String("ReferencedPaymentNonexistence");
/** Coston2 attests the XRP testnet. */
export const SOURCE_ID_TESTXRP = toBytes32String("testXRP");

/**
 * The standard address hash is keccak256 of the address STRING, not of any
 * decoded form. Getting this wrong yields a request that can never match a real
 * payment, so the attestation would confirm "no payment" for a payment that
 * plainly happened — a false default, which is the worst output this system
 * could produce.
 */
export function standardAddressHash(address: string): Hex {
  return keccak256(toHex(address));
}

export interface Obligation {
  requestId: string;
  agentVault: Address;
  redeemer: Address;
  /** the redemption's face value — NOT what the agent pays */
  valueUBA: string;
  /** the agent's fee, retained. See buildRequestBody. */
  feeUBA: string;
  executor: Address;
  paymentAddress: string;
  firstUnderlyingBlock: string;
  lastUnderlyingBlock: string;
  lastUnderlyingTimestamp: string;
  paymentReference: string;
}

export interface RequestBody {
  minimalBlockNumber: bigint;
  deadlineBlockNumber: bigint;
  deadlineTimestamp: bigint;
  destinationAddressHash: Hex;
  amount: bigint;
  standardPaymentReference: Hex;
  checkSourceAddresses: boolean;
  sourceAddressesRoot: Hex;
}

/**
 * The amount the agent is actually obliged to pay.
 *
 * ⚠ THIS ONE LINE VOIDED 93 "PROVEN DEFAULTS".
 *
 * The request originally asked about `valueUBA`. The agent pays
 * `valueUBA − feeUBA` — it retains its fee. Verified against a real settled
 * redemption: #43128188 has valueUBA 40,000,000 and feeUBA 200,000, and the
 * XRPL payment (6EBBD5CE…9F88) delivered exactly 39,800,000 drops.
 *
 * So a request for `valueUBA` can never match ANY payment, paid or unpaid, and
 * the verifier truthfully attests absence every single time. Ninety-three
 * redemptions came back as consensus-proven defaults, and every one of them was
 * an artefact of this subtraction.
 *
 * A clean sweep is not a strong result; it is a symptom. The control test in
 * control.ts exists to catch exactly this and did.
 */
export function amountOwed(o: Obligation): bigint {
  return BigInt(o.valueUBA) - BigInt(o.feeUBA);
}

export function buildRequestBody(o: Obligation): RequestBody {
  return {
    minimalBlockNumber: BigInt(o.firstUnderlyingBlock),
    deadlineBlockNumber: BigInt(o.lastUnderlyingBlock),
    deadlineTimestamp: BigInt(o.lastUnderlyingTimestamp),
    destinationAddressHash: standardAddressHash(o.paymentAddress),
    amount: amountOwed(o),
    standardPaymentReference: o.paymentReference as Hex,
    // The redeemer's payment may legitimately come from any of the agent's
    // addresses, so constraining the source would produce false nonexistence.
    checkSourceAddresses: false,
    sourceAddressesRoot: `0x${"0".repeat(64)}`,
  };
}

const REQUEST_BODY_ABI = [
  {
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
] as const;

const REQUEST_ABI = [
  { name: "attestationType", type: "bytes32" },
  { name: "sourceId", type: "bytes32" },
  { name: "messageIntegrityCode", type: "bytes32" },
  {
    name: "requestBody",
    type: "tuple",
    components: REQUEST_BODY_ABI[0].components,
  },
] as const;

/**
 * ABI-encode the full attestation request.
 *
 * The messageIntegrityCode is computed by the verifier server, not by us — it
 * commits to the RESPONSE the verifier will produce, which we cannot know in
 * advance. Passing zero here and letting `prepareRequest` fill it is the
 * documented flow; inventing a value would produce a request that is rejected
 * at the DA layer with no error surface, which is the exact silent failure the
 * FDC post-mortem tool exists to explain.
 */
export function encodeRequest(body: RequestBody, messageIntegrityCode: Hex = `0x${"0".repeat(64)}`): Hex {
  return encodeAbiParameters(REQUEST_ABI, [
    ATTESTATION_TYPE,
    SOURCE_ID_TESTXRP,
    messageIntegrityCode,
    body,
  ]);
}

export type Blocker =
  | "NONE"
  | "NOT_YET_DUE"
  | "PROOF_WINDOW_CLOSED"
  | "NOT_OUR_ROLE"
  | "NO_FUNDED_KEY";

export interface ExecutionPlan {
  requestId: string;
  agentVault: Address;
  /** what we would ask the FDC to attest */
  attestationType: Hex;
  sourceId: Hex;
  requestBody: RequestBody;
  abiEncodedRequest: Hex;
  /** the round the request would land in, if submitted now */
  targetRoundId: number;
  /** the call that claims the default once the proof is available */
  claimFunction: "redemptionPaymentDefault(IReferencedPaymentNonexistence.Proof,uint256)";
  /** why this cannot be executed right now, if anything */
  blocker: Blocker;
  blockerDetail?: string;
}

export const FDC_PROOF_WINDOW_SECONDS = 1_209_600;

/**
 * Produce the complete plan for one obligation.
 *
 * `hasFundedKey` is an explicit input rather than an assumption, so a plan
 * always states honestly whether it could be executed or only prepared.
 */
export function plan(
  o: Obligation,
  nowSeconds: number,
  opts: { ourAddress?: Address; hasFundedKey?: boolean } = {},
): ExecutionPlan {
  const body = buildRequestBody(o);
  const deadline = Number(o.lastUnderlyingTimestamp);
  const zero = "0x0000000000000000000000000000000000000000";

  let blocker: Blocker = "NONE";
  let blockerDetail: string | undefined;

  if (nowSeconds <= deadline) {
    blocker = "NOT_YET_DUE";
    blockerDetail = `deadline is ${new Date(deadline * 1000).toISOString()}`;
  } else if (nowSeconds > deadline + FDC_PROOF_WINDOW_SECONDS) {
    blocker = "PROOF_WINDOW_CLOSED";
    blockerDetail = "an FDC proof of this non-payment can no longer be minted";
  } else if (
    o.executor.toLowerCase() === zero ||
    (opts.ourAddress !== undefined && o.executor.toLowerCase() !== opts.ourAddress.toLowerCase())
  ) {
    // redemptionPaymentDefault is permissioned to the redeemer, the agent, or
    // the executor named at redeem() time. Preparing a proof we may not submit
    // is still useful — we can hand it to whoever may.
    blocker = "NOT_OUR_ROLE";
    blockerDetail =
      o.executor.toLowerCase() === zero
        ? "no executor was named; only the redeemer or agent may claim"
        : `executor is ${o.executor}`;
  } else if (opts.hasFundedKey !== true) {
    blocker = "NO_FUNDED_KEY";
    blockerDetail = "the request fee and gas require a funded key";
  }

  return {
    requestId: o.requestId,
    agentVault: o.agentVault,
    attestationType: ATTESTATION_TYPE,
    sourceId: SOURCE_ID_TESTXRP,
    requestBody: body,
    abiEncodedRequest: encodeRequest(body),
    targetRoundId: roundIdForTimestamp(nowSeconds),
    claimFunction: "redemptionPaymentDefault(IReferencedPaymentNonexistence.Proof,uint256)",
    blocker,
    ...(blockerDetail ? { blockerDetail } : {}),
  };
}
