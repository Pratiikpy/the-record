/**
 * ask-all — put the question to every unresolved obligation.
 *
 * Doing these one at a time would take hours, almost all of it waiting for
 * rounds. So the work is staged: prepare everything, submit everything, then
 * collect every proof in one sweep.
 *
 * Three outcomes are all real answers and all get recorded:
 *
 *   NON_PAYMENT_ATTESTED   consensus says the payment is absent — a default
 *   NOT_A_DEFAULT          the verifier refuses to attest absence, which means
 *                          it found the payment. The agent paid and simply
 *                          never recorded it on Flare.
 *   NO_PROOF_FOUND         no proof surfaced. Recorded as unresolved, NOT as a
 *                          network failure — the tool has already been wrong
 *                          about that once.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildRequestBody, roundIdForTimestamp, type Obligation } from "./executor.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "redemptions.json");
const OUT = join(HERE, "..", "out", "answers.json");

const API_KEY = "00000000-0000-0000-0000-000000000000";
const VERIFIER =
  "https://fdc-verifiers-testnet.flare.network/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest";
const DA_LAYER = "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round";

const FDC_HUB: Address = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const FEE_CFG: Address = "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e";

const coston2 = defineChain({
  id: 114,
  name: "Flare Coston2",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
});

const fdcHubAbi = [
  { type: "function", name: "requestAttestation", stateMutability: "payable", inputs: [{ name: "_data", type: "bytes" }], outputs: [] },
] as const;
const feeCfgAbi = [
  { type: "function", name: "getRequestFee", stateMutability: "view", inputs: [{ name: "_data", type: "bytes" }], outputs: [{ type: "uint256" }] },
] as const;

const log = (m: string): void => void process.stderr.write(`${m}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Answer {
  requestId: string;
  agentVault: string;
  amountUBA: string;
  verdict: "NON_PAYMENT_ATTESTED" | "NOT_A_DEFAULT" | "NO_PROOF_FOUND" | "PREPARE_FAILED";
  detail?: string;
  preparedStatus?: string;
  txHash?: string;
  computedRound?: number;
  provenInRound?: number;
  merkleProofNodes?: number;
}

async function main(): Promise<void> {
  const key = process.env.PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("PRIVATE_KEY not set");

  const scan = JSON.parse(readFileSync(IN, "utf8")) as { openRedemptions: Obligation[] };
  const now = Math.floor(Date.now() / 1000);
  const due = scan.openRedemptions
    .filter((o) => Number(o.lastUnderlyingTimestamp) < now)
    .sort((a, b) => Number(a.lastUnderlyingTimestamp) - Number(b.lastUnderlyingTimestamp));

  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: coston2, transport: http() });
  const wallet = createWalletClient({ account, chain: coston2, transport: http() });

  const startBal = await pub.getBalance({ address: account.address });
  log(`${due.length} obligations past deadline · balance ${formatEther(startBal)} C2FLR\n`);

  // ---- stage 1: prepare -----------------------------------------------------
  log("[1/3] preparing requests with the verifier…");
  const prepared: Array<{ o: Obligation; encoded: Hex }> = [];
  const answers: Answer[] = [];

  for (const [i, o] of due.entries()) {
    const b = buildRequestBody(o);
    let status = "ERROR";
    let encoded: Hex | undefined;
    try {
      const res = await fetch(VERIFIER, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-KEY": API_KEY },
        body: JSON.stringify({
          attestationType: "0x5265666572656e6365645061796d656e744e6f6e6578697374656e6365000000",
          sourceId: "0x7465737458525000000000000000000000000000000000000000000000000000",
          requestBody: {
            minimalBlockNumber: b.minimalBlockNumber.toString(),
            deadlineBlockNumber: b.deadlineBlockNumber.toString(),
            deadlineTimestamp: b.deadlineTimestamp.toString(),
            destinationAddressHash: b.destinationAddressHash,
            amount: b.amount.toString(),
            standardPaymentReference: b.standardPaymentReference,
            checkSourceAddresses: false,
            sourceAddressesRoot: b.sourceAddressesRoot,
          },
        }),
      });
      const j = (await res.json()) as { status?: string; abiEncodedRequest?: Hex };
      status = j.status ?? `HTTP ${res.status}`;
      encoded = j.abiEncodedRequest;
    } catch (e) {
      status = e instanceof Error ? e.message : String(e);
    }

    if (status.startsWith("VALID") && encoded) {
      prepared.push({ o, encoded });
    } else {
      // The verifier qualifies its refusal — "INVALID: REFERENCED TRANSACTION
      // EXISTS" — so an exact match on "INVALID" mis-files every real answer as
      // an error. Match the prefix and keep the full reason.
      const refused = status.startsWith("INVALID");
      answers.push({
        requestId: o.requestId,
        agentVault: o.agentVault,
        amountUBA: o.valueUBA,
        verdict: refused ? "NOT_A_DEFAULT" : "PREPARE_FAILED",
        preparedStatus: status,
        detail: refused
          ? "The verifier found the payment and refuses to attest absence. The agent DID pay on XRPL and simply never submitted the proof that records RedemptionPerformed on Flare — unresolved bookkeeping, not a default."
          : `verifier returned ${status}`,
      });
    }
    if ((i + 1) % 20 === 0) log(`      ${i + 1}/${due.length} prepared`);
  }
  log(`      VALID ${prepared.length} · other ${answers.length}`);

  // ---- stage 2: submit ------------------------------------------------------
  log(`\n[2/3] submitting ${prepared.length} attestation requests…`);
  const submitted: Array<{ o: Obligation; encoded: Hex; hash: Hex }> = [];
  let nonce = await pub.getTransactionCount({ address: account.address });

  for (const [i, p] of prepared.entries()) {
    try {
      const fee = await pub.readContract({
        address: FEE_CFG,
        abi: feeCfgAbi,
        functionName: "getRequestFee",
        args: [p.encoded],
      });
      // Fire without awaiting each receipt — nonces are managed explicitly so
      // 90 transactions do not take 90 block times.
      const hash = await wallet.writeContract({
        address: FDC_HUB,
        abi: fdcHubAbi,
        functionName: "requestAttestation",
        args: [p.encoded],
        value: fee,
        nonce: nonce++,
      });
      submitted.push({ ...p, hash });
    } catch (e) {
      answers.push({
        requestId: p.o.requestId,
        agentVault: p.o.agentVault,
        amountUBA: p.o.valueUBA,
        verdict: "NO_PROOF_FOUND",
        detail: `submit failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`,
      });
    }
    if ((i + 1) % 20 === 0) log(`      ${i + 1}/${prepared.length} sent`);
  }
  log(`      ${submitted.length} submitted`);

  if (submitted.length > 0) {
    const last = submitted[submitted.length - 1]!;
    const rec = await pub.waitForTransactionReceipt({ hash: last.hash });
    const blk = await pub.getBlock({ blockNumber: rec.blockNumber });
    log(`      last mined in block ${rec.blockNumber}, round ~${roundIdForTimestamp(Number(blk.timestamp))}`);
  }

  // ---- stage 3: collect -----------------------------------------------------
  log(`\n[3/3] collecting proofs (rounds finalise in ~2–4 min)…`);
  const pending = new Map(submitted.map((s) => [s.o.requestId, s]));

  for (let attempt = 0; attempt < 25 && pending.size > 0; attempt++) {
    await sleep(20_000);
    for (const [id, s] of [...pending]) {
      const rec = await pub.getTransactionReceipt({ hash: s.hash }).catch(() => null);
      if (!rec) continue;
      const blk = await pub.getBlock({ blockNumber: rec.blockNumber });
      const computed = roundIdForTimestamp(Number(blk.timestamp));

      for (const r of [computed - 1, computed, computed + 1, computed - 2, computed + 2]) {
        const res = await fetch(DA_LAYER, {
          method: "POST",
          headers: { "content-type": "application/json", "X-API-KEY": API_KEY },
          body: JSON.stringify({ votingRoundId: r, requestBytes: s.encoded }),
        });
        if (!res.ok) continue;
        const j = (await res.json()) as { response?: unknown; proof?: string[] };
        if (!j.response) continue;

        answers.push({
          requestId: id,
          agentVault: s.o.agentVault,
          amountUBA: s.o.valueUBA,
          verdict: "NON_PAYMENT_ATTESTED",
          detail:
            "Flare's data providers reached consensus that no qualifying payment exists in the block range. A proven default.",
          txHash: s.hash,
          computedRound: computed,
          provenInRound: r,
          merkleProofNodes: j.proof?.length ?? 0,
        });
        pending.delete(id);
        break;
      }
    }
    log(`      ${answers.length - (due.length - submitted.length)} / ${submitted.length} proofs in · ${pending.size} outstanding`);
  }

  for (const [id, s] of pending) {
    answers.push({
      requestId: id,
      agentVault: s.o.agentVault,
      amountUBA: s.o.valueUBA,
      verdict: "NO_PROOF_FOUND",
      detail:
        "No proof surfaced within the wait, in any round within two of the computed one. Recorded as unresolved — this tool has been wrong about a 'network failure' once already.",
      txHash: s.hash,
    });
  }

  // ---- report ---------------------------------------------------------------
  const endBal = await pub.getBalance({ address: account.address });
  const count = (v: Answer["verdict"]): number => answers.filter((a) => a.verdict === v).length;
  const defaultedValue = answers
    .filter((a) => a.verdict === "NON_PAYMENT_ATTESTED")
    .reduce((s, a) => s + BigInt(a.amountUBA), 0n);

  const out = {
    generatedAt: new Date().toISOString(),
    asker: account.address,
    examined: due.length,
    totals: {
      provenDefaults: count("NON_PAYMENT_ATTESTED"),
      notDefaults: count("NOT_A_DEFAULT"),
      noProofFound: count("NO_PROOF_FOUND"),
      prepareFailed: count("PREPARE_FAILED"),
      defaultedValueUBA: defaultedValue.toString(),
      defaultedValueXRP: Number(defaultedValue) / 1e6,
    },
    spentC2FLR: formatEther(startBal - endBal),
    caveat:
      "NOT_A_DEFAULT means the verifier found the payment: the agent paid on XRPL and never recorded it on Flare. No agent is accused of anything by that verdict.",
    answers: answers.sort((a, b) => a.verdict.localeCompare(b.verdict)),
  };

  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  log(`\n═══ ANSWERS ═══`);
  log(`  examined              ${out.examined}`);
  log(`  PROVEN DEFAULTS       ${out.totals.provenDefaults}  (${out.totals.defaultedValueXRP} XRP)`);
  log(`  agent had paid        ${out.totals.notDefaults}`);
  log(`  no proof found        ${out.totals.noProofFound}`);
  log(`  prepare failed        ${out.totals.prepareFailed}`);
  log(`  spent                 ${out.spentC2FLR} C2FLR`);
  log(`→ ${OUT}`);
}

main().catch((e: unknown) => {
  log(`ask-all failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
