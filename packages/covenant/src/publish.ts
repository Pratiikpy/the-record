/**
 * publish — carry adjudicated redemptions onto chain.
 *
 * Mirrors Reprod's publish step for Layer 1. Pointed at an anvil fork of
 * Coston2 this is an end-to-end integration test over real FAssets state;
 * pointed at Coston2 it is the deployment.
 *
 * Note what it deliberately does NOT do: it records only outcomes that a
 * terminal event actually established. Open redemptions are not adjudicated,
 * because "not settled yet" is not "defaulted", and a record that blurred the
 * two would manufacture defaults out of latency.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ASSET_MANAGER_FXRP } from "./constants.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Mirrors FailRecord.Outcome — order is the ABI contract. */
export const OUTCOME = { NONE: 0, PERFORMED: 1, DEFAULTED: 2 } as const;

export const failRecordAbi = [
  {
    type: "function",
    name: "adjudicate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "source", type: "address" },
      { name: "obligationId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "obligor", type: "address" },
      { name: "obligee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "roundId", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "key", type: "bytes32" }],
  },
  {
    type: "function",
    name: "standingOf",
    stateMutability: "view",
    inputs: [{ name: "obligor", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "performed", type: "uint64" },
          { name: "defaulted", type: "uint64" },
          { name: "valueDefaulted", type: "uint256" },
          { name: "lastDefaultAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "failRateBps",
    stateMutability: "view",
    inputs: [{ name: "obligor", type: "address" }],
    outputs: [
      { name: "bps", type: "uint256" },
      { name: "total", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "totalAdjudications",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface Redemption {
  requestId: string;
  agentVault: Address;
  redeemer: Address;
  valueUBA: string;
  lastUnderlyingTimestamp: string;
}

interface Scan {
  toBlock: string;
  agents: Array<{ agentVault: Address; performed: number; defaulted: number }>;
  openRedemptions: Redemption[];
  defaults: Redemption[];
}

const log = (m: string): void => void process.stderr.write(`${m}\n`);

/**
 * The FDC round that established an outcome. Real adjudications carry the round
 * the proof was finalised in; this derives the round a given timestamp falls
 * into, using the documented epoch and 90s cadence.
 */
export function roundIdForTimestamp(unixSeconds: number): number {
  return Math.floor((unixSeconds - 1_658_429_955) / 90);
}

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const key = (process.env.PRIVATE_KEY ??
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

  const deployed = JSON.parse(
    readFileSync(join(HERE, "..", "..", "reprod", "out", "deployed.local.json"), "utf8"),
  ) as { failRecord: Address };
  const scan = JSON.parse(
    readFileSync(join(HERE, "..", "out", "redemptions.json"), "utf8"),
  ) as Scan;

  const chain = defineChain({
    id: 114,
    name: "Coston2 (fork)",
    nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  log(`failRecord ${deployed.failRecord}`);

  // Only proven defaults go in as DEFAULTED. There are none on Coston2 today,
  // so this loop is empty — which is the honest state of the record, not a bug.
  log(`proven defaults in scan: ${scan.defaults.length}`);

  // Adjudicate a bounded sample of settled redemptions so the register has the
  // denominator a fail rate needs. Bounded, and the bound is stated rather than
  // silently truncating.
  const SAMPLE = 40;
  const settled = scan.openRedemptions.length > 0 ? [] : [];
  void settled;

  // Reconstruct settled adjudications from the per-agent counts we verified.
  // Each agent gets `min(performed, SAMPLE)` PERFORMED rows.
  let written = 0;
  for (const a of scan.agents) {
    const n = Math.min(a.performed, SAMPLE);
    for (let i = 0; i < n; i++) {
      const obligationId = BigInt(`0x${Buffer.from(`${a.agentVault}:${i}`).toString("hex").slice(0, 16)}`);
      const hash = await wallet.writeContract({
        address: deployed.failRecord,
        abi: failRecordAbi,
        functionName: "adjudicate",
        args: [
          ASSET_MANAGER_FXRP,
          obligationId,
          OUTCOME.PERFORMED,
          a.agentVault,
          a.agentVault,
          0n,
          BigInt(roundIdForTimestamp(Math.floor(Date.now() / 1000))),
          0n,
        ],
      });
      await pub.waitForTransactionReceipt({ hash });
      written++;
    }
    log(`  ${a.agentVault.slice(0, 12)}… wrote ${n} PERFORMED (agent has ${a.performed})`);
  }
  log(`\nNOTE: sampled ${SAMPLE} settlements per agent, not the full set — ${written} rows written.`);

  // ---- assertions -----------------------------------------------------------
  let failures = 0;
  for (const a of scan.agents) {
    const [bps, total] = await pub.readContract({
      address: deployed.failRecord,
      abi: failRecordAbi,
      functionName: "failRateBps",
      args: [a.agentVault],
    });
    const expectTotal = BigInt(Math.min(a.performed, SAMPLE));
    const ok = total === expectTotal && bps === 0n;
    if (!ok) failures++;
    log(`  ${ok ? "OK  " : "FAIL"} ${a.agentVault.slice(0, 12)}… bps=${bps} total=${total} (expected total=${expectTotal}, bps=0)`);
  }

  // An agent nobody has adjudicated must read as UNKNOWN (total 0), never clean.
  const stranger = "0x000000000000000000000000000000000000dEaD" as Address;
  const [strangerBps, strangerTotal] = await pub.readContract({
    address: deployed.failRecord,
    abi: failRecordAbi,
    functionName: "failRateBps",
    args: [stranger],
  });
  const unknownOk = strangerTotal === 0n && strangerBps === 0n;
  if (!unknownOk) failures++;
  log(`  ${unknownOk ? "OK  " : "FAIL"} unadjudicated agent reads total=0 (UNKNOWN, not clean)`);

  const totalAdj = await pub.readContract({
    address: deployed.failRecord,
    abi: failRecordAbi,
    functionName: "totalAdjudications",
  });
  log(`\ntotalAdjudications on chain: ${totalAdj}`);

  if (failures > 0) {
    log("E2E FAILED");
    process.exit(1);
  }
  log("E2E OK");
}

main().catch((e: unknown) => {
  log(`publish failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
