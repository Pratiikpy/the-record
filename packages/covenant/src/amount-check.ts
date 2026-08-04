/**
 * Find the real XRPL payment for a redemption the chain says was settled, and
 * compare it to what the request builder asked about.
 *
 * The control proved the builder matches nothing. The address hash is verified
 * correct against the spec, so the remaining suspects are the amount and the
 * block range — and the amount is the obvious one: the redeemer receives
 * valueUBA MINUS the agent's fee, not valueUBA.
 */
import { decodeEventLog, type Address, type Hex } from "viem";
import { redemptionEvents } from "./events.js";
import { rankEndpoints, blockNumber, sweepLogs } from "./rpc.js";
import { ASSET_MANAGER_FXRP } from "./constants.js";

const log = (m: string): void => void process.stderr.write(`${m}\n`);

async function xrplTx(account: string, limit = 400): Promise<Array<Record<string, unknown>>> {
  const res = await fetch("https://s.altnet.rippletest.net:51234", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "account_tx",
      params: [{ account, limit, ledger_index_min: -1, ledger_index_max: -1, binary: false }],
    }),
  });
  const j = (await res.json()) as { result?: { transactions?: Array<Record<string, unknown>> } };
  return j.result?.transactions ?? [];
}

async function main(): Promise<void> {
  const eps = await rankEndpoints(ASSET_MANAGER_FXRP);
  const head = await blockNumber(eps[0]!.url);
  const raw = await sweepLogs(eps, ASSET_MANAGER_FXRP, head - 20_000n, head);

  const requested = new Map<string, Record<string, unknown>>();
  const performed = new Set<string>();
  for (const l of raw) {
    for (const ev of redemptionEvents) {
      try {
        const d = decodeEventLog({ abi: [ev], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        const a = d.args as Record<string, unknown>;
        if (d.eventName === "RedemptionRequested") requested.set(String(a.requestId), a);
        else if (d.eventName === "RedemptionPerformed") performed.add(String(a.requestId));
        break;
      } catch {
        /* next */
      }
    }
  }

  const id = [...performed].find((x) => requested.has(x));
  if (!id) throw new Error("no settled redemption found");
  const r = requested.get(id)!;

  const valueUBA = BigInt(String(r.valueUBA));
  const feeUBA = BigInt(String(r.feeUBA));
  const payTo = String(r.paymentAddress);
  const ref = String(r.paymentReference).toLowerCase().replace(/^0x/u, "");

  log(`settled redemption #${id}`);
  log(`  paymentAddress   ${payTo}`);
  log(`  valueUBA         ${valueUBA}`);
  log(`  feeUBA           ${feeUBA}`);
  log(`  valueUBA-feeUBA  ${valueUBA - feeUBA}`);
  log(`  paymentReference 0x${ref}`);

  log(`\nsearching XRPL for the payment…`);
  const txs = await xrplTx(payTo);
  log(`  ${txs.length} transactions on that address`);

  for (const entry of txs) {
    const tx = (entry.tx ?? entry.tx_json) as Record<string, unknown> | undefined;
    if (!tx) continue;
    const memos = tx.Memos as Array<{ Memo?: { MemoData?: string } }> | undefined;
    const memo = memos?.[0]?.Memo?.MemoData?.toLowerCase();
    if (memo !== ref) continue;

    const amount = tx.Amount ?? tx.DeliverMax;
    log(`\n  ✓ FOUND the payment`);
    log(`    hash        ${String(entry.hash ?? tx.hash)}`);
    log(`    Amount      ${String(amount)} drops`);
    log(`    ledger      ${String(entry.ledger_index ?? "?")}`);
    log(`\n  we asked about   ${valueUBA} — ${amount === String(valueUBA) ? "MATCHES" : "DOES NOT MATCH"}`);
    log(`  actual paid      ${String(amount)}`);
    log(`  valueUBA-feeUBA  ${valueUBA - feeUBA} — ${amount === String(valueUBA - feeUBA) ? "MATCHES" : "does not match"}`);
    return;
  }
  log("\n  payment with that memo not found in the last 400 transactions");
}

main().catch((e: unknown) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
