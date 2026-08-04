/**
 * covenant scan — the load-bearing question for Layer 1.
 *
 * `redemptionPaymentDefault` is permissioned: only the redeemer, the agent, or
 * the executor appointed at redeem() time may call it. So an unaffiliated relay
 * cannot claim a stranger's default however good its proof.
 *
 * That makes one number decide the whole layer: **how many real redemptions
 * name a non-zero executor?**
 *
 *   ~0%  → nobody delegates today. `redeemWithGuardian` must create the demand,
 *          and Layer 1 leads with the wrapper, not the relay.
 *   >0%  → the role is already in use and there is a live fee market to enter.
 *
 * Reads only. No keys, no funds.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeEventLog, type Address } from "viem";

import { redemptionEvents, TERMINAL_EVENTS, ZERO_ADDRESS, type TerminalEvent } from "./events.js";
import { rankEndpoints, blockNumber, sweepLogs, type RawLog } from "./rpc.js";
import { ASSET_MANAGER_FXRP } from "./constants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "redemptions.json");

const log = (m: string): void => void process.stderr.write(`${m}\n`);

interface Requested {
  requestId: string;
  agentVault: Address;
  redeemer: Address;
  valueUBA: string;
  executor: Address;
  executorFeeNatWei: string;
  lastUnderlyingBlock: string;
  lastUnderlyingTimestamp: string;
  paymentReference: string;
  block: string;
}

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });

  log(`AssetManagerFXRP ${ASSET_MANAGER_FXRP}`);
  log("probing RPC endpoints for their eth_getLogs limits…");
  const eps = await rankEndpoints(ASSET_MANAGER_FXRP);
  log(`  ${eps.map((e) => `${new URL(e.url).host}=${e.maxRange}`).join(", ")}`);

  const head = await blockNumber(eps[0]!.url);

  // Window is deliberately explicit: a partial scan that pretends to be
  // complete is worse than no scan.
  const span = BigInt(process.env.SCAN_BLOCKS ?? "200000");
  const from = head > span ? head - span : 0n;
  log(`scanning blocks ${from} → ${head} (${head - from} blocks)`);

  let lastPct = -1;
  const raw: RawLog[] = await sweepLogs(eps, ASSET_MANAGER_FXRP, from, head, (pct, n, via) => {
    const p = Math.floor(pct / 10) * 10;
    if (p !== lastPct) {
      lastPct = p;
      log(`  ${p}% — ${n} logs (${via})`);
    }
  });
  log(`  ${raw.length} raw logs from the asset manager`);

  // Decode only the redemption lifecycle; everything else in this contract is
  // out of scope and must not be silently miscounted.
  const requested = new Map<string, Requested>();
  const terminal = new Map<string, TerminalEvent>();
  const byName = new Map<string, number>();

  for (const l of raw) {
    for (const ev of redemptionEvents) {
      try {
        const dec = decodeEventLog({
          abi: [ev],
          data: l.data,
          topics: l.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        });
        const name = dec.eventName as string;
        byName.set(name, (byName.get(name) ?? 0) + 1);
        const a = dec.args as Record<string, unknown>;
        const requestId = String(a.requestId);

        if (name === "RedemptionRequested") {
          requested.set(requestId, {
            requestId,
            agentVault: a.agentVault as Address,
            redeemer: a.redeemer as Address,
            valueUBA: String(a.valueUBA),
            executor: a.executor as Address,
            executorFeeNatWei: String(a.executorFeeNatWei),
            lastUnderlyingBlock: String(a.lastUnderlyingBlock),
            lastUnderlyingTimestamp: String(a.lastUnderlyingTimestamp),
            paymentReference: String(a.paymentReference),
            block: String(l.blockNumber),
          });
        } else if ((TERMINAL_EVENTS as readonly string[]).includes(name)) {
          terminal.set(requestId, name as TerminalEvent);
        }
        break;
      } catch {
        // not this event — try the next signature
      }
    }
  }

  const all = [...requested.values()];
  const withExecutor = all.filter((r) => r.executor.toLowerCase() !== ZERO_ADDRESS);
  const openNow = all.filter((r) => !terminal.has(r.requestId));
  const defaulted = all.filter((r) => terminal.get(r.requestId) === "RedemptionDefault");
  const performed = all.filter((r) => terminal.get(r.requestId) === "RedemptionPerformed");

  // Per-agent standing. This is what a redeemer actually wants before choosing
  // a counterparty, and it is the denominator that makes a fail rate mean
  // anything — an agent with 0 defaults and 0 redemptions is UNKNOWN, not good.
  const agents = [...new Set(all.map((r) => r.agentVault))].map((agentVault) => {
    const mine = all.filter((r) => r.agentVault === agentVault);
    const nPerformed = mine.filter((r) => terminal.get(r.requestId) === "RedemptionPerformed").length;
    const nDefaulted = mine.filter((r) => terminal.get(r.requestId) === "RedemptionDefault").length;
    const nOpen = mine.filter((r) => !terminal.has(r.requestId)).length;
    const adjudicated = nPerformed + nDefaulted;
    const valueUBA = mine.reduce((s, r) => s + BigInt(r.valueUBA), 0n);
    return {
      agentVault,
      requested: mine.length,
      performed: nPerformed,
      defaulted: nDefaulted,
      open: nOpen,
      adjudicated,
      /** null when nothing has been adjudicated — UNKNOWN, never "clean". */
      failRateBps: adjudicated === 0 ? null : Math.floor((nDefaulted * 10_000) / adjudicated),
      withExecutor: mine.filter((r) => r.executor.toLowerCase() !== ZERO_ADDRESS).length,
      valueUBA: valueUBA.toString(),
    };
  });
  agents.sort((a, b) => b.requested - a.requested);

  const result = {
    scannedAt: new Date().toISOString(),
    chainId: 114,
    assetManager: ASSET_MANAGER_FXRP,
    rpcEndpoints: eps.map((e) => ({ host: new URL(e.url).host, maxLogRange: e.maxRange })),
    fromBlock: from.toString(),
    toBlock: head.toString(),
    eventCounts: Object.fromEntries(byName),
    totals: {
      redemptionsRequested: all.length,
      performed: performed.length,
      defaulted: defaulted.length,
      openNow: openNow.length,
      /** THE number that decides Layer 1's shape. */
      withNamedExecutor: withExecutor.length,
      withNamedExecutorPct: all.length ? +((withExecutor.length / all.length) * 100).toFixed(2) : 0,
      distinctAgents: new Set(all.map((r) => r.agentVault)).size,
      distinctRedeemers: new Set(all.map((r) => r.redeemer)).size,
    },
    agents,
    openRedemptions: openNow.slice(0, 200),
    defaults: defaulted.slice(0, 200),
    executorsNamed: [...new Set(withExecutor.map((r) => r.executor))],
  };

  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  log(`\n─── covenant scan ───`);
  log(`events                ${JSON.stringify(result.eventCounts)}`);
  log(`redemptions requested ${result.totals.redemptionsRequested}`);
  log(`  performed           ${result.totals.performed}`);
  log(`  defaulted           ${result.totals.defaulted}`);
  log(`  still open          ${result.totals.openNow}`);
  log(`  NAMED AN EXECUTOR   ${result.totals.withNamedExecutor} (${result.totals.withNamedExecutorPct}%)`);
  log(`distinct agents       ${result.totals.distinctAgents}`);
  log(`→ ${OUT}`);
}

main().catch((e: unknown) => {
  log(`covenant scan failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
