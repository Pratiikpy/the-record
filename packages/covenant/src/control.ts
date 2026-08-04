/**
 * control — the test that decides whether the 93 defaults are real.
 *
 * Every one of 93 requests came back attestable as non-payment. A clean sweep
 * is exactly what a BROKEN request builder would produce: get the address hash
 * or the payment reference wrong, and no real payment can ever match, so the
 * verifier truthfully reports absence every single time. The result would be 93
 * false accusations that all look like consensus.
 *
 * So: take redemptions that provably WERE settled — `RedemptionPerformed` was
 * emitted for them — and build the identical request. If the builder is
 * correct, the verifier must REFUSE to attest absence for these, because the
 * payment is there to be found.
 *
 *   settled → INVALID   the builder finds real payments. The 93 stand.
 *   settled → VALID     the builder matches nothing, ever. All 93 are void.
 *
 * There is no interpretation to argue about; it is a straight falsification.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeEventLog, type Address, type Hex } from "viem";
import { redemptionEvents } from "./events.js";
import { rankEndpoints, blockNumber, sweepLogs } from "./rpc.js";
import { ASSET_MANAGER_FXRP } from "./constants.js";
import { buildRequestBody, type Obligation } from "./executor.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out", "control.json");

const API_KEY = "00000000-0000-0000-0000-000000000000";
const VERIFIER =
  "https://fdc-verifiers-testnet.flare.network/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest";

const log = (m: string): void => void process.stderr.write(`${m}\n`);

async function prepareStatus(o: Obligation): Promise<string> {
  const b = buildRequestBody(o);
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
  const j = (await res.json()) as { status?: string };
  return j.status ?? `HTTP ${res.status}`;
}

async function main(): Promise<void> {
  const eps = await rankEndpoints(ASSET_MANAGER_FXRP);
  const head = await blockNumber(eps[0]!.url);
  const from = head - 40_000n;
  log(`scanning blocks ${from}–${head} for SETTLED redemptions…`);

  const raw = await sweepLogs(eps, ASSET_MANAGER_FXRP, from, head);

  // Join RedemptionRequested to RedemptionPerformed: these are obligations the
  // chain itself says were paid.
  const requested = new Map<string, Obligation>();
  const performed = new Set<string>();

  for (const l of raw) {
    for (const ev of redemptionEvents) {
      try {
        const d = decodeEventLog({
          abi: [ev],
          data: l.data,
          topics: l.topics as [signature: Hex, ...args: Hex[]],
        });
        const a = d.args as Record<string, unknown>;
        const id = String(a.requestId);
        if (d.eventName === "RedemptionRequested") {
          requested.set(id, {
            requestId: id,
            agentVault: a.agentVault as Address,
            redeemer: a.redeemer as Address,
            valueUBA: String(a.valueUBA),
            feeUBA: String(a.feeUBA),
            executor: a.executor as Address,
            paymentAddress: String(a.paymentAddress),
            firstUnderlyingBlock: String(a.firstUnderlyingBlock),
            lastUnderlyingBlock: String(a.lastUnderlyingBlock),
            lastUnderlyingTimestamp: String(a.lastUnderlyingTimestamp),
            paymentReference: String(a.paymentReference),
          });
        } else if (d.eventName === "RedemptionPerformed") {
          performed.add(id);
        }
        break;
      } catch {
        /* not this event */
      }
    }
  }

  const settled = [...performed]
    .map((id) => requested.get(id))
    .filter((o): o is Obligation => o !== undefined)
    .slice(0, 12);

  if (settled.length === 0) throw new Error("found no settled redemption to test against");
  log(`testing ${settled.length} redemptions the chain says were PAID\n`);

  const results: Array<{ requestId: string; status: string; agentVault: string }> = [];
  for (const o of settled) {
    const status = await prepareStatus(o);
    results.push({ requestId: o.requestId, status, agentVault: o.agentVault });
    log(`  #${o.requestId.padEnd(10)} ${status}`);
  }

  // The verifier qualifies its refusal — "INVALID: REFERENCED TRANSACTION
  // EXISTS" — so an exact match on "INVALID" fails a control that actually
  // passed. Match the prefix, and keep the full string in the record because
  // the reason is the interesting part: it says the payment was FOUND.
  const attestableAsAbsent = results.filter((r) => r.status.startsWith("VALID")).length;
  const refused = results.filter((r) => r.status.startsWith("INVALID")).length;

  const passed = attestableAsAbsent === 0 && refused === results.length;

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      "If the request builder is correct, a redemption the chain says was PERFORMED must NOT be attestable as non-payment.",
    tested: results.length,
    refusedAsExpected: refused,
    wronglyAttestableAsAbsent: attestableAsAbsent,
    passed,
    conclusion: passed
      ? "The builder finds real payments. It refused every settled redemption, so the 93 non-payment attestations are not an artefact of a broken request — they are real defaults."
      : "FAILED. Settled redemptions are attestable as non-payment, which means the builder matches nothing and every one of the 93 'defaults' is void. Do not publish them.",
    results,
  };

  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  log(`\n${passed ? "PASS" : "FAIL"} — ${out.conclusion}`);
  log(`→ ${OUT}`);
  if (!passed) process.exit(1);
}

main().catch((e: unknown) => {
  log(`control failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

