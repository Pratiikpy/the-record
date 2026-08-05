/**
 * Run procedure CV-1 against a live Flare network and its XRP Ledger.
 *
 * Reads only. No credentials, no client, nobody's permission -- which is also
 * why this can point at MAINNET without capital or risk. The subject of an
 * assurance register should be the system real value settles on; Coston2 is
 * where faults are injected deliberately, and has to be asked for by name.
 *
 *   pnpm run run                 # Flare mainnet
 *   NETWORK=coston2 pnpm run run # the fault laboratory
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { type Address } from "viem";

import { accountTx, accountLedgerState, totalEscrowedDrops } from "./xrpl.js";
import { runCv1, type CoreVaultState } from "./cv1.js";
import { selectNetwork, clientFor, resolveAddresses } from "./network.js";
import { PackRecorder, packHash, envelope } from "./pack.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, process.env.CV1_OUT ?? "cv1.json");

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

  // Resolved through Flare's own contract registry rather than hardcoded, so
  // the identical procedure runs against mainnet and Coston2 and cannot read a
  // stale address after an upgrade.
  const net = selectNetwork();
  const client = clientFor(net);
  const at = await resolveAddresses(client, net);
  const CORE_VAULT_MANAGER: Address = at.coreVaultManager;
  const ASSET_MANAGER_FXRP: Address = at.assetManager;

  log(`network    ${net.label} (chain ${net.chainId})`);
  log(`asset      ${at.symbol}  ·  ${at.allAssetManagers.length} asset manager(s) registered`);
  log(`manager    ${ASSET_MANAGER_FXRP}`);
  log(`core vault ${CORE_VAULT_MANAGER}`);
  log("");
  log(`reading Core Vault state from ${net.label}…`);

  // Pinned BEFORE the reads, and every read pinned TO it. Reading the block
  // number afterwards named a later height than the state came from, so the
  // pack's anchor pointed at a block whose state might already differ -- a
  // replayer at that height would legitimately compute something else.
  const anchorBlock = await client.getBlockNumber();
  const pinned = { blockNumber: anchorBlock } as const;
  const anchorBlockTs = Number((await client.getBlock({ blockNumber: anchorBlock })).timestamp);

  const [coreVaultAddress, custodianAddress, availableFunds, escrowedFunds, allowedDestinations, amounts] =
    await Promise.all([
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "coreVaultAddress", ...pinned }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "custodianAddress", ...pinned }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "availableFunds", ...pinned }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "escrowedFunds", ...pinned }),
      client.readContract({
        address: CORE_VAULT_MANAGER,
        abi: cvmAbi,
        functionName: "getAllowedDestinationAddresses",
        ...pinned,
      }),
      client.readContract({
        address: ASSET_MANAGER_FXRP,
        abi: amAbi,
        functionName: "coreVaultAvailableAmount",
        ...pinned,
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

  log(`reading Core Vault payments and ledger state from ${net.isMainnet ? "the XRP Ledger" : "XRPL testnet"}…`);
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

  // Freeze the exact evidence this opinion was derived from, so the finding
  // outlives the endpoints it came from and a stranger can replay it offline.
  const rec = new PackRecorder();
  rec.record("flare.coreVaultAddress", { at: CORE_VAULT_MANAGER }, state.coreVaultAddress);
  rec.record("flare.custodianAddress", { at: CORE_VAULT_MANAGER }, state.custodianAddress);
  rec.record("flare.availableFunds", { at: CORE_VAULT_MANAGER }, state.availableFundsUBA);
  rec.record("flare.escrowedFunds", { at: CORE_VAULT_MANAGER }, state.escrowedFundsUBA);
  rec.record("flare.getAllowedDestinationAddresses", { at: CORE_VAULT_MANAGER }, state.allowedDestinations);
  rec.record("flare.coreVaultAvailableAmount", { at: ASSET_MANAGER_FXRP }, [
    state.immediatelyAvailableUBA,
    state.reportedTotalUBA,
  ]);
  // Record the ledger and close time alongside the state, so the pack is
  // SELF-DESCRIBING: a replayer can confirm the anchor from the evidence
  // itself rather than trusting the envelope that wraps it.
  rec.record("xrpl.accountLedgerState", { account: state.coreVaultAddress }, {
    ...state.onLedger,
    ledgerIndex: ledger.ledgerIndex,
    closeTimeUnix: ledger.closeTimeUnix,
  });
  rec.record("xrpl.accountTx", { account: state.coreVaultAddress, limit: 200 }, txs);

  const pack = rec.build({
    procedureId: "CV-1",
    network: { name: net.name, chainId: net.chainId },
    anchors: {
      flareBlock: Number(anchorBlock),
      // The ledger the balance and escrows were actually read at -- not the
      // newest of the last 200 transactions, which is an unrelated height.
      xrplLedger: ledger.ledgerIndex,
      // Measured, not assumed. This was hardcoded to 0, which asserted the two
      // chains were sampled at the same instant without ever checking.
      skewSeconds: ledger.closeTimeUnix > 0 ? Math.abs(anchorBlockTs - ledger.closeTimeUnix) : -1,
    },
  });
  const env = envelope(pack);
  mkdirSync(join(OUTDIR, "packs"), { recursive: true });
  writeFileSync(join(OUTDIR, "packs", `${env.packHash.slice(2, 18)}.json`), `${JSON.stringify(env, null, 2)}
`, "utf8");
  log(`  evidence pack ${env.packHash.slice(0, 18)}… (${pack.reads.length} reads)`);

  const period = new Date().toISOString().slice(0, 10);
  const report = runCv1(txs, state, period, {
    name: net.name,
    label: net.label,
    chainId: net.chainId,
    isMainnet: net.isMainnet,
  });

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
  log(`  pack:     ${env.packHash}`);
  log(`→ ${OUT}`);
}

main().catch((e: unknown) => {
  log(`CV-1 failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});



