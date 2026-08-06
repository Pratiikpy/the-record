/**
 * The red run for AB-1.
 *
 * AB-1's tests prove the adjudicator fires on constructed inputs. That is not
 * the same claim as "the control fires against a real chain", and our own scale
 * says V3 FALSIFIED means a fault was injected and caught — not that a unit
 * test passed. So this forks a chain, corrupts the storage slot holding one
 * agent's `underlyingBalanceUBA`, and reruns the identical reconciliation.
 *
 * It targets COSTON2, not mainnet, for the same reason CV-1's red run does:
 * anvil fetches forked state lazily, one slot at a time, and Flare's public
 * mainnet RPC rate-limits that hard enough that a single `getAgentInfo` went
 * from 25 seconds to over 200 under load. Coston2 answers fast, carries real
 * FXRP agents with real XRPL testnet addresses, and the control being tested is
 * identical. A falsification that cannot be re-run is not much of a
 * falsification.
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
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { managerAbi } from "./fassets-abi.js";
import { adjudicateBacking, type AgentReading } from "./agents.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "agents-fork-red.json");

const PORT = process.env.ANVIL_PORT ?? "8545";
const RPC = `http://127.0.0.1:${PORT}`;
/** Coston2's FXRP AssetManager. Its agents settle on the XRP Ledger TESTNET. */
const MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA" as const;
const XRPL = "https://s.altnet.rippletest.net:51234/";

const fork = defineChain({
  id: 114,
  name: "Coston2 fork",
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

interface Field {
  slot: `0x${string}`;
  /** bit offset of the field inside the 32-byte slot */
  offset: number;
  /** field width in bits */
  width: number;
  /** the slot's original 32-byte word */
  original: bigint;
}

/** Rebuild a slot word with `value` written into the located field. */
function pack(f: Field, value: bigint): bigint {
  const mask = ((1n << BigInt(f.width)) - 1n) << BigInt(f.offset);
  return (f.original & ~mask) | ((value << BigInt(f.offset)) & mask);
}

/**
 * Locate the field by arithmetic, then confirm it with exactly one mutation.
 *
 * Two earlier versions failed on cost, not on logic. The first derived
 * candidate slots from keccak256(vault, p) — 19,200 storage reads. The second
 * probed every (offset, width) pair by writing the slot and re-calling
 * `getAgentInfo`, which decodes forty fields across twenty-seven slots; several
 * hundred of those degrade an anvil fork until a single call exceeds three
 * minutes.
 *
 * The value is already known, so the search does not need the chain at all.
 * Read each touched slot's raw word once, then find locally which slot, offset
 * and width hold exactly that value. Only the winner is confirmed against the
 * contract, and only once. Twenty-nine calls instead of several hundred.
 */
async function findField(vault: `0x${string}`, target: bigint): Promise<Field | null> {
  const slots = await touchedSlots(vault);
  log(`  getAgentInfo touches ${slots.length} storage slots on the manager`);

  const candidates: Field[] = [];
  for (const slot of slots) {
    let word: bigint;
    try {
      const raw = await client.getStorageAt({ address: MANAGER, slot });
      if (raw === undefined) continue;
      word = BigInt(raw);
    } catch {
      continue;
    }
    // Solidity packs on byte boundaries, so an 8-bit stride covers every
    // layout it can actually produce.
    for (const width of [64, 96, 128, 160, 256]) {
      const mask = (1n << BigInt(width)) - 1n;
      for (let offset = 0; offset + width <= 256; offset += 8) {
        if (((word >> BigInt(offset)) & mask) === target) {
          candidates.push({ slot, offset, width, original: word });
        }
      }
    }
  }
  log(`  ${candidates.length} slot/offset/width candidates hold that exact value`);

  for (const f of candidates) {
    const probe = target + 12_345n;
    let hit = false;
    try {
      await setStorage(f.slot, pack(f, probe));
      const after = await infoOf(vault);
      hit = BigInt(after.underlyingBalanceUBA) === probe;
    } catch {
      hit = false;
    } finally {
      await setStorage(f.slot, f.original).catch(() => {
        log("  warning: restore failed; the fork is now dirty");
      });
    }
    if (hit) {
      log(`  field confirmed: slot ${f.slot}, offset ${f.offset}, width ${f.width}`);
      return f;
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
  log(`forked Coston2 at block ${block}`);

  const [vaults] = (await client.readContract({
    address: MANAGER,
    abi: managerAbi,
    functionName: "getAllAgents",
    args: [0n, 50n],
  })) as readonly [readonly `0x${string}`[], bigint];

  // The agent with the most underlying, so the fault is unambiguous.
  let chosen: { vault: `0x${string}`; account: string; underlying: bigint } | null = null;
  for (const v of vaults) {
    const i = await infoOf(v);
    const u = BigInt(i.underlyingBalanceUBA);
    if (u > 0n && (chosen === null || u > chosen.underlying)) {
      chosen = { vault: v, account: i.underlyingAddressString as string, underlying: u };
    }
  }
  if (!chosen) throw new Error("no agent with a positive underlying balance to test against");
  log(`subject: ${chosen.account} (${XRP(chosen.underlying)} XRP recorded on Flare)`);

  log("\n─── GREEN — forked chain, no fault ───");
  const green = await readingOf(chosen.vault, chosen.account);
  if (green.onLedgerUBA === null) throw new Error("could not read the XRP Ledger; refusing to claim a result");
  const greenVerdict = adjudicateBacking([green, green, green]);
  log(`  flare ${XRP(green.flareUnderlyingUBA)} | xrpl ${XRP(green.onLedgerUBA)}`);
  log(`  OPINION: ${greenVerdict.opinion}`);

  log("\ninjecting fault: agent underlyingBalanceUBA");
  const field = await findField(chosen.vault, chosen.underlying);
  if (!field) throw new Error("could not locate the storage field; refusing to claim a falsification");

  // Overstate Flare's record of the backing. The XRP Ledger is untouched, so a
  // real reconciliation must now report a shortfall.
  const corrupted = chosen.underlying * 3n;
  await setStorage(field.slot, pack(field, corrupted));
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
        network: { name: "coston2-fork", label: "Coston2 fork", chainId: 114 },
        forkedAtBlock: block.toString(),
        subject: { agentVault: chosen.vault, underlyingAddress: chosen.account },
        slot: field.slot,
        field: { offset: field.offset, width: field.width },
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
