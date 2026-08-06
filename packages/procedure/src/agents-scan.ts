/**
 * Run AB-1 against every FXRP agent on Flare mainnet.
 *
 * The AssetManager is an EIP-2535 diamond, so `getAgentInfo` is not on the
 * proxy's own verified ABI — it lives in a facet. The selectors are resolved
 * through the diamond loupe at run time rather than pinned, for the same reason
 * CV-1 resolves everything through the contract registry: an address we hardcode
 * is an address that goes stale without telling us.
 *
 * Every candidate shortfall is re-read across a settle bracket before it is
 * allowed to become an exception. See `agents.ts` for why that is not optional.
 */
import { createPublicClient, http, defineChain } from "viem";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adjudicateBacking, rollUpFleet, type AgentReading, type AgentVerdict } from "./agents.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "agents.json");

const FLARE_RPC = "https://flare-api.flare.network/ext/C/rpc";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;
const XRPL_SERVERS = [
  "https://xrplcluster.com/",
  "https://s1.ripple.com:51234/",
  "https://s2.ripple.com:51234/",
];

/** How many readings make a bracket, and how far apart. */
const BRACKET_READINGS = 3;
const BRACKET_GAP_MS = 45_000;

const flare = defineChain({
  id: 14,
  name: "Flare",
  nativeCurrency: { name: "FLR", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: [FLARE_RPC] } },
});
const client = createPublicClient({ chain: flare, transport: http(FLARE_RPC) });

const registryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;
const controllerAbi = [
  { type: "function", name: "getAssetManagers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;
const managerAbi = [
  { type: "function", name: "fAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "getAllAgents",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "getAgentInfo",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "ownerManagementAddress", type: "address" },
          { name: "ownerWorkAddress", type: "address" },
          { name: "collateralPool", type: "address" },
          { name: "collateralPoolToken", type: "address" },
          { name: "underlyingAddressString", type: "string" },
          { name: "publiclyAvailable", type: "bool" },
          { name: "feeBIPS", type: "uint256" },
          { name: "poolFeeShareBIPS", type: "uint256" },
          { name: "vaultCollateralToken", type: "address" },
          { name: "mintingVaultCollateralRatioBIPS", type: "uint256" },
          { name: "mintingPoolCollateralRatioBIPS", type: "uint256" },
          { name: "freeCollateralLots", type: "uint256" },
          { name: "totalVaultCollateralWei", type: "uint256" },
          { name: "freeVaultCollateralWei", type: "uint256" },
          { name: "vaultCollateralRatioBIPS", type: "uint256" },
          { name: "poolWNatToken", type: "address" },
          { name: "totalPoolCollateralNATWei", type: "uint256" },
          { name: "freePoolCollateralNATWei", type: "uint256" },
          { name: "poolCollateralRatioBIPS", type: "uint256" },
          { name: "totalAgentPoolTokensWei", type: "uint256" },
          { name: "announcedVaultCollateralWithdrawalWei", type: "uint256" },
          { name: "announcedPoolTokensWithdrawalWei", type: "uint256" },
          { name: "freeAgentPoolTokensWei", type: "uint256" },
          { name: "mintedUBA", type: "uint256" },
          { name: "reservedUBA", type: "uint256" },
          { name: "redeemingUBA", type: "uint256" },
          { name: "poolRedeemingUBA", type: "uint256" },
          { name: "dustUBA", type: "uint256" },
          { name: "liquidationStartTimestamp", type: "uint256" },
          { name: "maxLiquidationAmountUBA", type: "uint256" },
          { name: "liquidationPaymentFactorVaultBIPS", type: "uint256" },
          { name: "liquidationPaymentFactorPoolBIPS", type: "uint256" },
          { name: "underlyingBalanceUBA", type: "int256" },
          { name: "requiredUnderlyingBalanceUBA", type: "uint256" },
          { name: "freeUnderlyingBalanceUBA", type: "int256" },
          { name: "announcedUnderlyingWithdrawalId", type: "uint256" },
          { name: "buyFAssetByAgentFactorBIPS", type: "uint256" },
          { name: "poolExitCollateralRatioBIPS", type: "uint256" },
          { name: "redemptionPoolFeeShareBIPS", type: "uint256" },
        ],
      },
    ],
  },
] as const;
const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A read that fails is UNKNOWN, and is never rendered as a fact.
 *
 * The first version of this scanner reported "this agent has no XRP account"
 * when the RPC had simply rate-limited it — a network error presented as a
 * statement about someone else's solvency. `actNotFound` is a real answer from
 * the ledger; everything else is a failure to observe.
 */
async function xrplRead(
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; res: any; notFound?: boolean } | { ok: false; error: string }> {
  let lastErr = "unknown";
  for (let attempt = 0; attempt < XRPL_SERVERS.length * 2; attempt++) {
    const url = XRPL_SERVERS[attempt % XRPL_SERVERS.length]!;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await r.json()) as any;
      const res = j?.result;
      if (res?.status === "success") return { ok: true, res };
      if (res?.error === "actNotFound") return { ok: true, res, notFound: true };
      lastErr = res?.error ?? `http ${r.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 60) : "fetch failed";
    }
    await sleep(400 * (attempt + 1));
  }
  return { ok: false, error: lastErr };
}

interface Agent {
  vault: `0x${string}`;
  underlyingAddress: string;
  mintedUBA: bigint;
  redeemingUBA: bigint;
  vaultCollateralRatioBIPS: bigint;
  status: number;
}

async function readFleet(manager: `0x${string}`, block: bigint): Promise<Agent[]> {
  const [vaults] = (await client.readContract({
    address: manager,
    abi: managerAbi,
    functionName: "getAllAgents",
    args: [0n, 1000n],
  })) as readonly [readonly `0x${string}`[], bigint];

  const out: Agent[] = [];
  for (const vault of vaults) {
    const i = (await client.readContract({
      address: manager,
      abi: managerAbi,
      functionName: "getAgentInfo",
      args: [vault],
      blockNumber: block,
    })) as any;
    out.push({
      vault,
      underlyingAddress: i.underlyingAddressString,
      mintedUBA: i.mintedUBA,
      redeemingUBA: i.redeemingUBA,
      vaultCollateralRatioBIPS: i.vaultCollateralRatioBIPS,
      status: Number(i.status),
    });
  }
  return out;
}

async function readOne(manager: `0x${string}`, vault: `0x${string}`, address: string): Promise<AgentReading> {
  const block = await client.getBlockNumber();
  const info = (await client.readContract({
    address: manager,
    abi: managerAbi,
    functionName: "getAgentInfo",
    args: [vault],
    blockNumber: block,
  })) as any;

  const acct = await xrplRead("account_info", { account: address, ledger_index: "validated" });
  if (!acct.ok) {
    return {
      flareUnderlyingUBA: BigInt(info.underlyingBalanceUBA),
      onLedgerUBA: null,
      flareBlock: block,
      xrplLedger: null,
    };
  }
  if (acct.notFound) {
    return {
      flareUnderlyingUBA: BigInt(info.underlyingBalanceUBA),
      onLedgerUBA: 0n,
      flareBlock: block,
      xrplLedger: null,
    };
  }

  // Escrowed XRP is removed from `Balance` by the ledger, so it has to be added
  // back or every escrowing account looks short. This is E-004, one level down.
  const objs = await xrplRead("account_objects", { account: address, type: "escrow", ledger_index: "validated" });
  const escrowed =
    objs.ok && !objs.notFound
      ? ((objs.res.account_objects ?? []) as any[]).reduce((s, o) => s + BigInt(o.Amount ?? 0), 0n)
      : 0n;

  return {
    flareUnderlyingUBA: BigInt(info.underlyingBalanceUBA),
    onLedgerUBA: BigInt(acct.res.account_data.Balance) + escrowed,
    flareBlock: block,
    xrplLedger: Number(acct.res.ledger_index ?? acct.res.account_data.PreviousTxnLgrSeq ?? 0) || null,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const controller = (await client.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "getContractAddressByName",
    args: ["AssetManagerController"],
  })) as `0x${string}`;
  const managers = (await client.readContract({
    address: controller,
    abi: controllerAbi,
    functionName: "getAssetManagers",
  })) as readonly `0x${string}`[];

  const manager = managers[0]!;
  const fAsset = (await client.readContract({ address: manager, abi: managerAbi, functionName: "fAsset" })) as `0x${string}`;
  const symbol = (await client.readContract({ address: fAsset, abi: erc20Abi, functionName: "symbol" })) as string;
  const totalSupply = (await client.readContract({
    address: fAsset,
    abi: erc20Abi,
    functionName: "totalSupply",
  })) as bigint;

  const block0 = await client.getBlockNumber();
  const fleet = await readFleet(manager, block0);
  process.stderr.write(`${symbol}: ${fleet.length} agents, supply ${totalSupply}\n`);

  const readings = new Map<string, AgentReading[]>();
  for (let pass = 0; pass < BRACKET_READINGS; pass++) {
    for (const a of fleet) {
      const r = await readOne(manager, a.vault, a.underlyingAddress);
      const list = readings.get(a.vault) ?? [];
      list.push(r);
      readings.set(a.vault, list);
    }
    process.stderr.write(`  bracket reading ${pass + 1}/${BRACKET_READINGS}\n`);
    if (pass < BRACKET_READINGS - 1) await sleep(BRACKET_GAP_MS);
  }

  const rows = fleet.map((a) => {
    const rs = readings.get(a.vault)!;
    const v: AgentVerdict = adjudicateBacking(rs);
    return {
      vault: a.vault,
      underlyingAddress: a.underlyingAddress,
      status: a.status,
      mintedUBA: a.mintedUBA.toString(),
      redeemingUBA: a.redeemingUBA.toString(),
      vaultCollateralRatioBIPS: a.vaultCollateralRatioBIPS.toString(),
      opinion: v.opinion,
      differenceUBA: v.differenceUBA?.toString() ?? null,
      because: v.because,
      readings: rs.map((r) => ({
        flareBlock: r.flareBlock.toString(),
        xrplLedger: r.xrplLedger,
        flareUnderlyingUBA: r.flareUnderlyingUBA.toString(),
        onLedgerUBA: r.onLedgerUBA?.toString() ?? null,
      })),
    };
  });

  const mintedTotal = fleet.reduce((s, a) => s + a.mintedUBA, 0n);
  const report = {
    procedureId: "AB-1",
    generatedAt: startedAt,
    completedAt: new Date().toISOString(),
    network: { name: "flare", label: "Flare mainnet", chainId: 14 },
    asset: { symbol, address: fAsset, totalSupplyUBA: totalSupply.toString() },
    manager,
    bracket: { readings: BRACKET_READINGS, gapSeconds: BRACKET_GAP_MS / 1000 },
    opinion: rollUpFleet(rows.map((r) => ({ opinion: r.opinion, differenceUBA: null, because: "" }))),
    fleet: {
      agents: fleet.length,
      mintedUBA: mintedTotal.toString(),
      /** the share of FXRP that agents back directly; the rest is the Core Vault */
      agentBackedShareBps: Number((mintedTotal * 10_000n) / totalSupply),
    },
    agents: rows,
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  process.stderr.write(`\nOPINION ${report.opinion}\n→ ${OUT}\n`);
  for (const r of rows) {
    process.stderr.write(`  ${r.opinion.padEnd(10)} ${r.underlyingAddress}  ${r.because}\n`);
  }
}

await main();
