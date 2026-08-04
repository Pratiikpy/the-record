/**
 * Diagnostic: what event signatures does the deployed AssetManager ACTUALLY
 * emit, versus what the published interface docs say?
 *
 * Written because a scan decoded 2,352 RedemptionRequested events and zero
 * terminal events out of 26k logs — which cannot be true of a live system, and
 * pointed at a topic0 mismatch rather than an absence of completions.
 */
import { keccak256, toHex } from "viem";
import { rankEndpoints, blockNumber, sweepLogs } from "./rpc.js";
import { ASSET_MANAGER_FXRP } from "./constants.js";

const log = (m: string): void => void process.stderr.write(`${m}\n`);

/** Candidate signatures, including the uint64/uint256 variants of requestId. */
const CANDIDATES: string[] = [
  "RedemptionRequested(address,address,uint256,string,uint256,uint256,uint256,uint256,uint256,bytes32,address,uint256)",
  "RedemptionRequested(address,address,uint64,string,uint256,uint256,uint256,uint256,uint256,bytes32,address,uint256)",
  "RedemptionPerformed(address,address,uint64,bytes32,uint256,int256)",
  "RedemptionPerformed(address,address,uint256,bytes32,uint256,int256)",
  "RedemptionDefault(address,address,uint256,uint256,uint256,uint256)",
  "RedemptionDefault(address,address,uint64,uint256,uint256,uint256)",
  "RedemptionPaymentFailed(address,address,uint256,bytes32,int256,string)",
  "RedemptionPaymentFailed(address,address,uint64,bytes32,int256,string)",
  "RedemptionPaymentBlocked(address,address,uint256,bytes32,int256)",
  "RedemptionPaymentBlocked(address,address,uint64,bytes32,int256)",
  "RedemptionRejected(address,address,uint256,uint256)",
  "RedemptionRejected(address,address,uint64,uint256)",
  "RedemptionRequestIncomplete(address,uint256)",
  "RedemptionTicketCreated(address,uint256,uint256)",
  "RedemptionTicketUpdated(address,uint256,uint256)",
  "RedemptionTicketDeleted(address,uint256)",
  "RedemptionPoolFeeMinted(address,uint256,uint256)",
  "MintingExecuted(address,uint256,uint256,uint256,uint256)",
  "CollateralReserved(address,address,uint256,uint256,uint256,uint256,uint256,uint256,string,bytes32,address,uint256)",
];

async function main(): Promise<void> {
  const known = new Map<string, string>();
  for (const sig of CANDIDATES) known.set(keccak256(toHex(sig)), sig);

  const eps = await rankEndpoints(ASSET_MANAGER_FXRP);
  log(`endpoints: ${eps.map((e) => `${new URL(e.url).host}=${e.maxRange}`).join(", ")}`);
  const head = await blockNumber(eps[0]!.url);
  const span = BigInt(process.env.SCAN_BLOCKS ?? "60000");
  const from = head - span;

  log(`sampling blocks ${from} → ${head}`);
  let last = -1;
  const logs = await sweepLogs(eps, ASSET_MANAGER_FXRP, from, head, (pct, n, via) => {
    const p = Math.floor(pct / 20) * 20;
    if (p !== last) {
      last = p;
      log(`  ${p}% — ${n} logs (${via})`);
    }
  });

  const counts = new Map<string, number>();
  for (const l of logs) {
    const t0 = l.topics[0];
    if (t0) counts.set(t0, (counts.get(t0) ?? 0) + 1);
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  log(`\n${rows.length} distinct event signatures in the window\n`);
  for (const [t0, n] of rows) {
    const sig = known.get(t0);
    log(`${String(n).padStart(6)}  ${t0}  ${sig ?? "— UNIDENTIFIED —"}`);
  }

  const missing = [...known.entries()].filter(([t0]) => !counts.has(t0));
  log(`\ncandidates NOT seen in this window:`);
  for (const [, sig] of missing) log(`   ${sig.split("(")[0]}  ${sig.includes("uint64") ? "(uint64 variant)" : ""}`);
}

main().catch((e: unknown) => {
  log(String(e instanceof Error ? e.stack : e));
  process.exit(1);
});
