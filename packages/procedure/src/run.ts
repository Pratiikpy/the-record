/**
 * Run procedure CV-1 against live Coston2 + XRPL testnet.
 *
 * Reads only. No credentials, no client, nobody's permission.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, http, defineChain, type Address } from "viem";

import { accountTx, accountLedgerState, totalEscrowedDrops } from "./xrpl.js";
import { runCv1, type CoreVaultState } from "./cv1.js";
import { CORE_VAULT_MANAGER, ASSET_MANAGER_FXRP } from "./addresses.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, process.env.CV1_OUT ?? "cv1.json");

/**
 * RPC_URL is overridable so the identical procedure can be pointed at a forked
 * chain with a deliberately corrupted Core Vault. A control that has only ever
 * printed CLEAN is indistinguishable from a control that cannot fail, and there
 * is no sentence that fixes that — only a red run.
 */
const RPC = process.env.RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

const coston2 = defineChain({
  id: 114,
  name: "Flare Coston2",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const cvmAbi = [
  { type: "function", name: "coreVaultAddress", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "custodianAddress", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "availableFunds", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "escrowedFunds", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "function",
    name: "getAllowedDestinationAddresses",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string[]" }],
  },
] as const;

const amAbi = [
  {
    type: "function",
    name: "coreVaultAvailableAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "immediatelyAvailableUBA", type: "uint256" },
      { name: "totalAvailableUBA", type: "uint256" },
    ],
  },
] as const;

const log = (m: string): void => void process.stderr.write(`${m}\n`);

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });
  const client = createPublicClient({ chain: coston2, transport: http(RPC, { batch: true }) });

  log("reading Core Vault state from Coston2…");
  const [coreVaultAddress, custodianAddress, availableFunds, escrowedFunds, allowedDestinations, amounts] =
    await Promise.all([
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "coreVaultAddress" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "custodianAddress" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "availableFunds" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "escrowedFunds" }),
      client.readContract({
        address: CORE_VAULT_MANAGER,
        abi: cvmAbi,
        functionName: "getAllowedDestinationAddresses",
      }),
      client.readContract({
        address: ASSET_MANAGER_FXRP,
        abi: amAbi,
        functionName: "coreVaultAvailableAmount",
      }),
    ]);

  const state: CoreVaultState = {
    coreVaultAddress,
    custodianAddress,
    allowedDestinations: [...allowedDestinations],
    availableFundsUBA: availableFunds.toString(),
    escrowedFundsUBA: escrowedFunds.toString(),
    immediatelyAvailableUBA: amounts[0].toString(),
    reportedTotalUBA: amounts[1].toString(),
  };

  log(`  vault      ${state.coreVaultAddress}`);
  log(`  custodian  ${state.custodianAddress}`);
  log(`  allowlist  ${state.allowedDestinations.length} addresses`);
  log(`  available  ${state.availableFundsUBA} UBA`);
  log(`  escrowed   ${state.escrowedFundsUBA} UBA`);

  log("reading Core Vault payments and ledger state from XRPL testnet…");
  const [txs, ledger] = await Promise.all([
    accountTx(state.coreVaultAddress, 200),
    accountLedgerState(state.coreVaultAddress),
  ]);
  state.onLedger = {
    balanceDrops: ledger.balanceDrops.toString(),
    escrowedDrops: totalEscrowedDrops(ledger.escrows).toString(),
    escrowCount: ledger.escrows.length,
    reserveDrops: ledger.reserveDrops.toString(),
    nonXrpEscrows: ledger.nonXrpEscrows,
  };
  log(`  ${txs.length} transactions`);
  log(`  liquid     ${state.onLedger.balanceDrops} drops (reserve ${state.onLedger.reserveDrops})`);
  log(`  escrowed   ${state.onLedger.escrowedDrops} drops in ${state.onLedger.escrowCount} objects`);

  const period = new Date().toISOString().slice(0, 10);
  const report = runCv1(txs, state, period);

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  log(`\n─── CV-1 · ${period} ───`);
  for (const c of report.controls) {
    log(`  ${c.opinion.padEnd(10)} ${c.id}  ${c.title} (${c.tested} tested)`);
    for (const e of c.exceptions) log(`             ✗ ${e}`);
    if (c.disclaimer) log(`             ? ${c.disclaimer}`);
    if (c.observation) log(`             · ${c.observation}`);
  }
  log(`\n  OPINION: ${report.opinion}`);
  log(`  evidence: ${report.evidence.xrplTransactions} txs, ${report.evidence.outflows} outflows, digest ${report.evidence.evidenceDigest}`);
  log(`→ ${OUT}`);
}

main().catch((e: unknown) => {
  log(`CV-1 failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});



