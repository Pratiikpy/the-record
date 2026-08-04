/**
 * ask — put one real question to the Flare Data Connector:
 *
 *   "Did this agent pay this redemption, or not?"
 *
 * Requesting an attestation is permissionless. We are not the appointed
 * executor and may not submit the claim, but anyone may ask, and the resulting
 * proof is public — so the answer can be handed to whoever IS entitled to act.
 *
 * The honest possibilities are three, and the tool must report whichever
 * happens rather than the one that flatters the thesis:
 *
 *   VALID + attested   the payment genuinely never happened
 *   INVALID            the verifier says the request does not hold, which most
 *                      likely means the agent DID pay
 *   no proof           the round did not produce one — a silent FDC failure,
 *                      which is itself the thing worth documenting
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildRequestBody, roundIdForTimestamp, type Obligation } from "./executor.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "redemptions.json");
const OUT = join(HERE, "..", "out", "answer.json");

/** Documented public key for the testnet verifier and DA layer. */
const API_KEY = "00000000-0000-0000-0000-000000000000";
const VERIFIER =
  "https://fdc-verifiers-testnet.flare.network/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest";
const DA_LAYER = "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round";

const FDC_HUB: Address = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const RELAY: Address = "0xa10B672D1c62e5457b17af63d4302add6A99d7dE";

const coston2 = defineChain({
  id: 114,
  name: "Flare Coston2",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
});

const fdcHubAbi = [
  {
    type: "function",
    name: "requestAttestation",
    stateMutability: "payable",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [],
  },
] as const;

const feeCfgAbi = [
  {
    type: "function",
    name: "getRequestFee",
    stateMutability: "view",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const FEE_CFG: Address = "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e";

const log = (m: string): void => void process.stderr.write(`${m}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const key = process.env.PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("PRIVATE_KEY not set");

  const scan = JSON.parse(readFileSync(IN, "utf8")) as { openRedemptions: Obligation[] };
  const now = Math.floor(Date.now() / 1000);

  // The most urgent real obligation: past deadline, soonest proof window to close.
  const candidates = scan.openRedemptions
    .filter((o) => Number(o.lastUnderlyingTimestamp) < now)
    .sort((a, b) => Number(a.lastUnderlyingTimestamp) - Number(b.lastUnderlyingTimestamp));
  const o = candidates[0];
  if (!o) throw new Error("no overdue obligation to ask about");

  const body = buildRequestBody(o);
  log(`asking about redemption #${o.requestId}`);
  log(`  agent      ${o.agentVault}`);
  log(`  redeemer   ${o.redeemer}`);
  log(`  amount     ${o.valueUBA} UBA (${Number(BigInt(o.valueUBA)) / 1e6} XRP)`);
  log(`  payTo      ${o.paymentAddress}`);
  log(`  deadline   ${new Date(Number(o.lastUnderlyingTimestamp) * 1000).toISOString()}`);
  log(`  blocks     ${body.minimalBlockNumber}–${body.deadlineBlockNumber}`);

  // ---- 1. ask the verifier to prepare the request ---------------------------
  // It computes the messageIntegrityCode, which commits to the response it will
  // produce. We cannot compute that ourselves.
  log("\n[1/4] prepareRequest…");
  const prep = await fetch(VERIFIER, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": API_KEY },
    body: JSON.stringify({
      attestationType: "0x5265666572656e6365645061796d656e744e6f6e6578697374656e6365000000",
      sourceId: "0x7465737458525000000000000000000000000000000000000000000000000000",
      requestBody: {
        minimalBlockNumber: body.minimalBlockNumber.toString(),
        deadlineBlockNumber: body.deadlineBlockNumber.toString(),
        deadlineTimestamp: body.deadlineTimestamp.toString(),
        destinationAddressHash: body.destinationAddressHash,
        amount: body.amount.toString(),
        standardPaymentReference: body.standardPaymentReference,
        checkSourceAddresses: false,
        sourceAddressesRoot: body.sourceAddressesRoot,
      },
    }),
  });

  const prepText = await prep.text();
  log(`      HTTP ${prep.status}`);
  if (!prep.ok) {
    log(`      ${prepText.slice(0, 400)}`);
    writeFileSync(OUT, JSON.stringify({ stage: "prepareRequest", status: prep.status, body: prepText }, null, 2));
    throw new Error("verifier refused the request");
  }

  const prepared = JSON.parse(prepText) as {
    status?: string;
    abiEncodedRequest?: Hex;
  };
  log(`      status: ${prepared.status}`);

  // INVALID here is a real answer, not an error: the verifier is saying it
  // cannot attest that this payment is absent — which most likely means it
  // happened.
  if (prepared.status !== "VALID" || !prepared.abiEncodedRequest) {
    const answer = {
      requestId: o.requestId,
      agentVault: o.agentVault,
      verdict: "NOT_A_DEFAULT",
      reason: `the verifier returned ${prepared.status}: it will not attest that this payment is missing`,
      interpretation:
        "The most likely explanation is that the agent DID pay on XRPL and simply never submitted the proof that records RedemptionPerformed on Flare. That is unresolved bookkeeping, not a default.",
      preparedStatus: prepared.status,
      askedAt: new Date().toISOString(),
    };
    writeFileSync(OUT, `${JSON.stringify(answer, null, 2)}\n`);
    log(`\n  ANSWER: ${answer.verdict}`);
    log(`  ${answer.reason}`);
    log(`  ${answer.interpretation}`);
    log(`→ ${OUT}`);
    return;
  }

  // ---- 2. submit it on chain ------------------------------------------------
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: coston2, transport: http() });
  const wallet = createWalletClient({ account, chain: coston2, transport: http() });

  const fee = await pub.readContract({
    address: FEE_CFG,
    abi: feeCfgAbi,
    functionName: "getRequestFee",
    args: [prepared.abiEncodedRequest],
  });
  log(`\n[2/4] requestAttestation (fee ${fee} wei)…`);

  const hash = await wallet.writeContract({
    address: FDC_HUB,
    abi: fdcHubAbi,
    functionName: "requestAttestation",
    args: [prepared.abiEncodedRequest],
    value: fee,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
  const roundId = roundIdForTimestamp(Number(block.timestamp));
  log(`      tx ${hash}`);
  log(`      block ${receipt.blockNumber} · round ${roundId} · gas ${receipt.gasUsed}`);

  // ---- 3. wait for the round to finalise ------------------------------------
  //
  // ⚠ DO NOT TRUST THE ARITHMETIC ALONE.
  //
  // `floor((blockTs - 1658429955)/90)` gave 1415664 for a request whose proof
  // landed in 1415663. A request is collected into the round that is OPEN when
  // it arrives, and that is not always the round the formula names — it went
  // off by one on the very first real request.
  //
  // The first version of this tool reported NO_PROOF_PRODUCED and called it a
  // silent FDC failure. The proof existed the whole time, one round away. So
  // the computed round is now a starting point and a small window either side
  // is searched, because a false "the network failed" is a worse error than a
  // slow answer.
  const windowToSearch = [roundId - 1, roundId, roundId + 1, roundId - 2, roundId + 2];
  log(`\n[3/4] waiting for a proof in rounds ${roundId - 2}–${roundId + 2}…`);

  let proof: unknown = null;
  let foundRound: number | null = null;

  for (let i = 0; i < 40 && proof === null; i++) {
    for (const r of windowToSearch) {
      const res = await fetch(DA_LAYER, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-KEY": API_KEY },
        body: JSON.stringify({ votingRoundId: r, requestBytes: prepared.abiEncodedRequest }),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { response?: unknown; proof?: unknown };
      if (j.response) {
        proof = j;
        foundRound = r;
        log(`      found in round ${r}${r === roundId ? "" : ` (computed ${roundId} — off by ${r - roundId})`}`);
        break;
      }
    }
    if (proof === null) {
      await sleep(15_000);
      log(`      ${(i + 1) * 15}s — not yet`);
    }
  }

  // ---- 4. report whatever came back -----------------------------------------
  const answer = proof
    ? {
        requestId: o.requestId,
        agentVault: o.agentVault,
        redeemer: o.redeemer,
        amountUBA: o.valueUBA,
        verdict: "NON_PAYMENT_ATTESTED",
        meaning:
          "Flare's data providers reached consensus that no qualifying payment exists in the block range. This obligation genuinely was not settled, and the appointed executor can claim the default with this proof.",
        computedRound: roundId,
        provenInRound: foundRound,
        txHash: hash,
        proof,
        askedAt: new Date().toISOString(),
      }
    : {
        requestId: o.requestId,
        agentVault: o.agentVault,
        verdict: "NO_PROOF_FOUND",
        meaning:
          "No proof appeared in any round within two either side of the computed one, within the wait. This may be a genuine consensus failure — but note the tool once reported exactly this while the proof sat one round away, so treat it as unresolved rather than as evidence the network failed.",
        computedRound: roundId,
        searchedRounds: windowToSearch,
        txHash: hash,
        askedAt: new Date().toISOString(),
      };

  writeFileSync(OUT, `${JSON.stringify(answer, null, 2)}\n`);
  log(`\n[4/4] ANSWER: ${answer.verdict}`);
  log(`  ${answer.meaning}`);
  log(`→ ${OUT}`);
}

main().catch((e: unknown) => {
  log(`ask failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
