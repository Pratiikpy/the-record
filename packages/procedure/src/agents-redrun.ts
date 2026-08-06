/**
 * The red run for AB-1.
 *
 * AB-1's tests prove the adjudicator fires on constructed inputs. That is not
 * the same claim as "the control fires against a real chain", and our own scale
 * says V3 FALSIFIED means a fault was injected and caught — not that a unit
 * test passed. So this forks Flare mainnet, corrupts the storage slot holding
 * one agent's `underlyingBalanceUBA`, and reruns the identical reconciliation.
 *
 * The XRP Ledger is left untouched and real. That asymmetry is the whole point:
 * the fault moves exactly one side of a two-chain comparison, so a control that
 * genuinely reconciles must notice, and a control that is secretly comparing a
 * number to itself cannot.
 *
 * The slot is FOUND, not hardcoded. Agent state lives in the AssetManager
 * diamond behind a mapping, so the script asks the node which slots a
 * `getAgentInfo` call actually touches and keeps the one whose corruption
 * changes what the getter returns. A slot we assumed would be a slot that
 * silently stopped being right.
 *
 * Exits non-zero if the control does NOT fire.
 */
import { createPublicClient, http, defineChain, encodeFunctionData, pad, toHex } from "viem";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { managerAbi } from "./fassets-abi.js";
import { adjudicateBacking, type AgentReading } from "./agents.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "agents-fork-red.json");

const PORT = process.env.ANVIL_PORT ?? "8545";
const RPC = `http://127.0.0.1:${PORT}`;
const MANAGER = "0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8" as const;
const XRPL = "https://s1.ripple.com:51234/";

const fork = defineChain({
  id: 14,
  name: "Flare fork",
  nativeCurrency: { name: "FLR", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const client = createPublicClient({ chain: fork, transport: http(RPC, { timeout: 180_000, retryCount: 0 }) });

const log = (s: string): void => {
  process.stderr.write(`${s}\n`);
};

async function xrplBalance(account: string): Promise<bigint | null> {
  try {
    const r = await fetch(XRPL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "account_info", params: [{ account, ledger_index: "validated" }] }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json()) as any;
    if (j?.result?.status !== "success") return null;
    return BigInt(j.result.account_data.Balance);
  } catch {
    return null;
  }
}

async function setStorage(slot: `0x${string}`, value: bigint): Promise<void> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setStorageAt",
      params: [MANAGER, slot, pad(toHex(value), { size: 32 })],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await res.json()) as any;
  if (j.error) throw new Error(`anvil_setStorageAt failed: ${JSON.stringify(j.error)}`);
}

const infoOf = async (vault: `0x${string}`): Promise<any> =>
  client.readContract({ address: MANAGER, abi: managerAbi, functionName: "getAgentInfo", args: [vault] });

/**
 * Find the slot that actually backs `underlyingBalanceUBA`.
 *
 * The first version derived candidate slots from keccak256(vault, p) across
 * every plausible mapping position — 19,200 storage reads, and it never
 * finished. `eth_createAccessList` answers the same question in one call: it
 * returns exactly the slots a `getAgentInfo` call touches, so the search space
 * is the truth rather than a guess about how FAssets lays out its diamond.
 *
 * The winner is confirmed by MUTATION, not by matching a value. Several slots
 * can hold the same number by coincidence and only one changes what the getter
 * returns; the original is restored after each probe, so a wrong guess leaves
 * the fork exactly as it was.
 */
async function touchedSlots(vault: `0x${string}`): Promise<`0x${string}`[]> {
  const data = encodeFunctionData({ abi: managerAbi, functionName: "getAgentInfo", args: [vault] });
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_createAccessList",
      params: [{ to: MANAGER, data }, "latest"],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await res.json()) as any;
  const list = j?.result?.accessList ?? [];
  const out: `0x${string}`[] = [];
  for (const entry of list) {
    if ((entry.address as string).toLowerCase() !== MANAGER.toLowerCase()) continue;
    for (const k of entry.storageKeys ?? []) out.push(k as `0x${string}`);
  }
  return out;
}

async function findSlot(vault: `0x${string}`, target: bigint): Promise<`0x${string}` | null> {
  const probe = target + 1_000_000n;
  const slots = await touchedSlots(vault);
  log(`  getAgentInfo touches ${slots.length} storage slots on the manager`);

  for (const [i, slot] of slots.entries()) {
    // A probe that errors tells us nothing about this slot and must not abort
    // the run: the point of the search is to survive wrong guesses. The slot is
    // always restored, including when the probe throws.
    let current: `0x${string}` | undefined;
    try {
      current = await client.getStorageAt({ address: MANAGER, slot });
    } catch {
      continue;
    }
    if (current === undefined) continue;

    let moved = false;
    try {
      // The field is packed with its neighbours, so an exact match is not
      // required — only that changing this slot changes the getter.
      await setStorage(slot, probe);
      const after = await infoOf(vault);
      moved = BigInt(after.underlyingBalanceUBA) === probe;
    } catch {
      moved = false;
    } finally {
      try {
        await setStorage(slot, BigInt(current));
      } catch {
        log(`  warning: could not restore slot ${i}; the fork is now dirty`);
      }
    }
    if (moved) {
      log(`  slot located: ${slot}`);
      return slot;
    }
  }
  return null;
}

async function readingOf(vault: `0x${string}`, account: string): Promise<AgentReading> {
  const info = await infoOf(vault);
  const bal = await xrplBalance(account);
  return {
    flareUnderlyingUBA: BigInt(info.underlyingBalanceUBA),
    onLedgerUBA: bal,
    flareBlock: await client.getBlockNumber(),
    xrplLedger: null,
  };
}

const XRP = (v: bigint): string => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });

  const block = await client.getBlockNumber();
  log(`forked Flare mainnet at block ${block}`);

  // The subject comes from the published AB-1 report rather than from a fresh
  // sweep of the fleet. Cold state on a fork is fetched from upstream one slot
  // at a time, and reading all six agents just to pick one timed out before the
  // run could start. The choice is still verified against the fork below.
  const report = JSON.parse(readFileSync(join(OUTDIR, "agents.json"), "utf8")) as {
    agents: Array<{ vault: `0x${string}`; underlyingAddress: string; readings: Array<{ flareUnderlyingUBA: string }> }>;
  };
  const biggest = report.agents
    .map((a) => ({ a, u: BigInt(a.readings[a.readings.length - 1]?.flareUnderlyingUBA ?? "0") }))
    .sort((x, y) => (y.u > x.u ? 1 : y.u < x.u ? -1 : 0))[0];
  if (!biggest || biggest.u <= 0n) throw new Error("no agent with a positive underlying balance in agents.json");

  const live = await infoOf(biggest.a.vault);
  const chosen = {
    vault: biggest.a.vault,
    account: live.underlyingAddressString as string,
    // Read from the fork, not from the report: the report may be minutes old and
    // the fault has to be injected against the value the fork actually holds.
    underlying: BigInt(live.underlyingBalanceUBA),
  };
  if (chosen.underlying <= 0n) throw new Error("chosen agent has no underlying balance on the fork");
  log(`subject: ${chosen.account} (${XRP(chosen.underlying)} XRP recorded on Flare)`);

  log("\n─── GREEN — forked chain, no fault ───");
  const green = await readingOf(chosen.vault, chosen.account);
  if (green.onLedgerUBA === null) throw new Error("could not read the XRP Ledger; refusing to claim a result");
  const greenVerdict = adjudicateBacking([green, green, green]);
  log(`  flare ${XRP(green.flareUnderlyingUBA)} | xrpl ${XRP(green.onLedgerUBA)}`);
  log(`  OPINION: ${greenVerdict.opinion}`);

  log("\ninjecting fault: agent underlyingBalanceUBA");
  const slot = await findSlot(chosen.vault, chosen.underlying);
  if (!slot) throw new Error("could not locate the storage slot; refusing to claim a falsification");

  // Overstate Flare's record of the backing. The XRP Ledger is untouched, so a
  // real reconciliation must now report a shortfall.
  const corrupted = chosen.underlying * 2n;
  await setStorage(slot, corrupted);
  const confirm = await infoOf(chosen.vault);
  if (BigInt(confirm.underlyingBalanceUBA) !== corrupted) throw new Error("fault did not take");
  log(`  underlyingBalanceUBA ${chosen.underlying} → ${corrupted}`);
  log(`  confirmed: getAgentInfo now reads ${confirm.underlyingBalanceUBA}`);

  log("\n─── RED — same reconciliation, corrupted Flare record ───");
  const red = await readingOf(chosen.vault, chosen.account);
  const redVerdict = adjudicateBacking([red, red, red]);
  log(`  flare ${XRP(red.flareUnderlyingUBA)} | xrpl ${red.onLedgerUBA === null ? "?" : XRP(red.onLedgerUBA)}`);
  log(`  OPINION: ${redVerdict.opinion}`);
  if (redVerdict.differenceUBA !== null) log(`  ${redVerdict.because}`);

  const fired = greenVerdict.opinion === "CLEAN" && redVerdict.opinion === "EXCEPTION";
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        procedureId: "AB-1",
        kind: "fork-red",
        generatedAt: new Date().toISOString(),
        network: { name: "flare-fork", label: "Flare mainnet fork", chainId: 14 },
        forkedAtBlock: block.toString(),
        subject: { agentVault: chosen.vault, underlyingAddress: chosen.account },
        slot,
        fault: { field: "underlyingBalanceUBA", from: chosen.underlying.toString(), to: corrupted.toString() },
        green: { opinion: greenVerdict.opinion, because: greenVerdict.because },
        red: { opinion: redVerdict.opinion, because: redVerdict.because },
        opinion: redVerdict.opinion,
        fired,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (!fired) {
    log("\n✗ the control did NOT fire. AB-1 cannot currently detect a backing shortfall.");
    process.exit(1);
  }
  log("\n✓ the control fires. CLEAN → EXCEPTION on a single corrupted storage slot.");
  log(`→ ${OUT}`);
}

await main();
