/**
 * The red run — prove CV-1's cross-chain controls can actually fail.
 *
 * A monitor that has only ever printed CLEAN is indistinguishable from a
 * monitor that CANNOT print anything else, and no amount of prose fixes that.
 * This procedure has already shipped one control that could never fail: an
 * identity between two figures that both derived from the same storage slot.
 * It passed every day for the same reason a broken thermometer reads room
 * temperature.
 *
 * So the control is tested the only way a control can be: by breaking the thing
 * it watches and demanding that it notice.
 *
 * Coston2 is forked into a local anvil. `CoreVaultManager.escrowedFunds` is
 * overwritten in storage. The XRP Ledger is left completely untouched and real
 * — that asymmetry is the point, because a fault only shows up when the two
 * sources are genuinely independent. Then the identical procedure runs against
 * the fork.
 *
 * This script exits non-zero if C3 stays CLEAN. A control that survives its own
 * fault injection is a bug, and it should break the build.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, http, defineChain, toHex, type Address, type Hex } from "viem";

import { accountTx, accountLedgerState, totalEscrowedDrops } from "./xrpl.js";
import { runCv1, type CoreVaultState, type Cv1Report } from "./cv1.js";
import { CORE_VAULT_MANAGER, ASSET_MANAGER_FXRP } from "./addresses.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");

/**
 * The fault laboratory is Coston2, always.
 *
 * Without this the default (mainnet) applies, and the run would fork Coston2,
 * corrupt a Coston2 storage slot, then reconcile the result against the REAL
 * XRP Ledger vault -- two unrelated systems, compared with total confidence.
 * The controls would have "fired" and the red run would have proven nothing.
 *
 * Setting it here only works because xrpl.ts resolves its endpoints per call
 * rather than at module load. ESM hoists imports above this statement, so a
 * module-level constant there would already have been fixed to the default
 * before this line ran -- which was the original bug.
 */
process.env.NETWORK = "coston2";

const UPSTREAM = process.env.FORK_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const PORT = Number(process.env.ANVIL_PORT ?? 8545);
const FORK = `http://127.0.0.1:${PORT}`;

/**
 * The injected fault: roughly double what Flare records as escrowed.
 *
 * Overridable so the guard below can itself be tested. Setting this to the
 * chain's true escrow figure makes the "fault" a no-op, and the script must then
 * exit non-zero — otherwise the guard is decorative and this whole file proves
 * nothing. Run it: `FAULT_ESCROW_UBA=<current escrowedFunds> pnpm redrun`.
 */
const CORRUPTED_ESCROW = BigInt(process.env.FAULT_ESCROW_UBA ?? "999999999999");

const local = defineChain({
  id: 114,
  name: "Coston2 fork",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [FORK] } },
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

const MASK128 = (1n << 128n) - 1n;

/** Wait for anvil to answer, rather than sleeping and hoping. */
async function waitForRpc(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`anvil did not answer on ${url} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function rawCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(FORK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/**
 * Locate the slot packing `escrowedFunds` and `availableFunds`.
 *
 * Not hardcoded. The slot index is derived by reading storage and matching it
 * against what the contract's own getters return, so a contract upgrade that
 * moves the field makes this script fail loudly instead of corrupting an
 * unrelated slot and reporting a green control for the wrong reason.
 */
async function findPackedSlot(available: bigint, escrowed: bigint): Promise<{ slot: number; layout: string }> {
  for (let slot = 0; slot < 128; slot++) {
    const word = BigInt((await rawCall("eth_getStorageAt", [CORE_VAULT_MANAGER, toHex(slot), "latest"])) as Hex);
    const lower = word & MASK128;
    const upper = word >> 128n;
    if (lower === available && upper === escrowed) return { slot, layout: "[escrowed:high][available:low]" };
    if (lower === escrowed && upper === available) return { slot, layout: "[available:high][escrowed:low]" };
  }
  throw new Error(
    `no storage slot packs availableFunds=${available} with escrowedFunds=${escrowed} — the contract layout changed, refusing to corrupt a slot blindly`,
  );
}

async function readState(client: ReturnType<typeof createPublicClient>): Promise<CoreVaultState> {
  const [coreVaultAddress, custodianAddress, availableFunds, escrowedFunds, allowedDestinations, amounts] =
    await Promise.all([
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "coreVaultAddress" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "custodianAddress" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "availableFunds" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "escrowedFunds" }),
      client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "getAllowedDestinationAddresses" }),
      client.readContract({ address: ASSET_MANAGER_FXRP, abi: amAbi, functionName: "coreVaultAvailableAmount" }),
    ]);

  return {
    coreVaultAddress,
    custodianAddress,
    allowedDestinations: [...allowedDestinations],
    availableFundsUBA: availableFunds.toString(),
    escrowedFundsUBA: escrowedFunds.toString(),
    immediatelyAvailableUBA: amounts[0].toString(),
    reportedTotalUBA: amounts[1].toString(),
  };
}

function summarise(label: string, r: Cv1Report): void {
  log(`\n─── ${label} ───`);
  for (const c of r.controls) {
    log(`  ${c.opinion.padEnd(10)} ${c.id}  ${c.title}`);
    for (const e of c.exceptions) log(`             ✗ ${e}`);
    if (c.disclaimer) log(`             ? ${c.disclaimer}`);
  }
  log(`  OPINION: ${r.opinion}   digest ${r.evidence.evidenceDigest}`);
}

/**
 * Refuse to run against a chain this script did not create.
 *
 * The first attempt silently attached to an anvil left over from an earlier
 * session whose escrow slot was ALREADY corrupted — so the "green" baseline
 * came back EXCEPTION and, had the check been the other way round, a red result
 * would have been claimed over a chain nobody had faulted. Fault injection is
 * only evidence if the before-state is known.
 */
async function requirePortFree(): Promise<void> {
  try {
    const res = await fetch(FORK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) {
      throw new Error(
        `something is already serving JSON-RPC on port ${PORT}. Stop it, or set ANVIL_PORT — this script will not inject a fault into a chain whose prior state it does not know.`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("something is already serving")) throw e;
    // connection refused / timeout: the port is free, which is what we want
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });
  await requirePortFree();

  log(`forking ${UPSTREAM} into anvil on port ${PORT}…`);
  const anvil: ChildProcess = spawn(
    "anvil",
    ["--fork-url", UPSTREAM, "--port", String(PORT), "--silent", "--no-mining"],
    { stdio: "ignore", shell: process.platform === "win32" },
  );
  const stop = (): void => void anvil.kill();
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  try {
    await waitForRpc(FORK);
    const block = await rawCall("eth_blockNumber", []);
    log(`  forked at block ${BigInt(block as Hex)}`);

    const client = createPublicClient({ chain: local, transport: http(FORK) });

    // ── The XRP Ledger is read ONCE and reused for both runs. It is never
    // touched by the fault. If the two runs disagree, the disagreement can only
    // come from the Flare side — which is exactly what a cross-chain control is
    // supposed to detect.
    log("reading the real XRP Ledger (untouched by the fault)…");
    const beforeState = await readState(client);
    const [txs, ledger] = await Promise.all([
      accountTx(beforeState.coreVaultAddress, 200),
      accountLedgerState(beforeState.coreVaultAddress),
    ]);
    const onLedger = {
      balanceDrops: ledger.balanceDrops.toString(),
      escrowedDrops: totalEscrowedDrops(ledger.escrows).toString(),
      escrowCount: ledger.escrows.length,
      reserveDrops: ledger.reserveDrops.toString(),
      nonXrpEscrows: ledger.nonXrpEscrows,
    };
    log(`  ${onLedger.escrowCount} escrow objects, ${onLedger.escrowedDrops} drops`);

    const green = runCv1(txs, { ...beforeState, onLedger }, "fork-green");
    summarise("GREEN — forked chain, no fault", green);

    if (green.opinion !== "CLEAN") {
      throw new Error(
        `the fork is not clean before the fault (${green.opinion}), so a red result would prove nothing`,
      );
    }

    // ── Inject the fault.
    const available = BigInt(beforeState.availableFundsUBA);
    const escrowed = BigInt(beforeState.escrowedFundsUBA);
    const { slot, layout } = await findPackedSlot(available, escrowed);
    log(`\ninjecting fault: slot ${slot} ${layout}`);
    log(`  escrowedFunds ${escrowed} → ${CORRUPTED_ESCROW}`);
    if (CORRUPTED_ESCROW === escrowed) {
      log("  (the injected value equals the true value — this run is testing the guard, not the control)");
    }

    const word =
      layout === "[escrowed:high][available:low]"
        ? (CORRUPTED_ESCROW << 128n) | available
        : (available << 128n) | CORRUPTED_ESCROW;
    await rawCall("anvil_setStorageAt", [
      CORE_VAULT_MANAGER as Address,
      toHex(slot),
      toHex(word, { size: 32 }),
    ]);

    const afterState = await readState(client);
    if (BigInt(afterState.escrowedFundsUBA) !== CORRUPTED_ESCROW) {
      throw new Error(
        `the fault did not land: escrowedFunds() still reads ${afterState.escrowedFundsUBA}. A red run over an uncorrupted chain proves nothing.`,
      );
    }
    log(`  confirmed: escrowedFunds() now reads ${afterState.escrowedFundsUBA}`);

    const red = runCv1(txs, { ...afterState, onLedger }, "fork-red");
    summarise("RED — same procedure, corrupted escrow figure", red);

    const c3 = red.controls.find((c) => c.id === "C3");
    if (c3?.opinion !== "EXCEPTION") {
      // Two very different failures, and conflating them would itself be a
      // false accusation: a control that survives a real fault is broken, but a
      // control that stays CLEAN when nothing was actually broken is correct.
      throw new Error(
        CORRUPTED_ESCROW === escrowed
          ? `no fault was injected — FAULT_ESCROW_UBA equals the chain's true escrowedFunds (${escrowed}), so C3 was right to report CLEAN. This run exercised the guard, not the control.`
          : `C3 reported ${c3?.opinion} against a chain whose escrowedFunds reads ${CORRUPTED_ESCROW} while the XRP Ledger holds ${onLedger.escrowedDrops} drops. The control did not fail when the two sources disagreed, which means it was never testing anything.`,
      );
    }
    if (green.evidence.evidenceDigest === red.evidence.evidenceDigest) {
      throw new Error("green and red carry the same evidence digest, so the digest is not evidence-sensitive");
    }

    writeFileSync(join(OUTDIR, "cv1-fork-green.json"), `${JSON.stringify(green, null, 2)}\n`, "utf8");
    writeFileSync(join(OUTDIR, "cv1-fork-red.json"), `${JSON.stringify(red, null, 2)}\n`, "utf8");

    log(`\n✓ the control fires. ${green.opinion} → ${red.opinion} on a single corrupted storage slot.`);
    log(`  ${green.evidence.evidenceDigest} → ${red.evidence.evidenceDigest}`);
    log(`→ ${join(OUTDIR, "cv1-fork-green.json")}`);
    log(`→ ${join(OUTDIR, "cv1-fork-red.json")}`);
  } finally {
    anvil.kill();
  }
}

main().catch((e: unknown) => {
  log(`\nred run failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
