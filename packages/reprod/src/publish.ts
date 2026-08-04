/**
 * publish — carry scan verdicts onto chain.
 *
 * This closes the loop the whole system rests on: a verdict that lives only in
 * a JSON file is our assertion, but a verdict a Solidity contract can read is a
 * dependency other protocols can gate execution on.
 *
 * Runs against any RPC. Pointed at a local anvil fork of Coston2 it is an
 * end-to-end integration test over the REAL registry state; pointed at Coston2
 * it is the deployment.
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
import type { ScanResult } from "./scan.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Mirrors ReproRegistry.Verdict — order is the ABI contract, do not reorder. */
export const VERDICT = {
  NONE: 0,
  NO_KNOWN_SOURCE: 1,
  SIMULATED: 2,
  UNREPRODUCIBLE: 3,
  DIVERGED: 4,
  REPRODUCED: 5,
} as const;

export const registryAbi = [
  {
    type: "function",
    name: "assess",
    stateMutability: "nonpayable",
    inputs: [
      { name: "codeHash", type: "bytes32" },
      { name: "verdict", type: "uint8" },
      { name: "rebuiltDigest", type: "bytes32" },
      { name: "divergence", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimSource",
    stateMutability: "nonpayable",
    inputs: [
      { name: "codeHash", type: "bytes32" },
      { name: "repo", type: "string" },
      { name: "commitSha", type: "string" },
      { name: "recipeHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reproStatus",
    stateMutability: "view",
    inputs: [{ name: "codeHash", type: "bytes32" }],
    outputs: [
      { name: "verdict", type: "uint8" },
      { name: "rebuiltDigest", type: "bytes32" },
      { name: "assessedAt", type: "uint64" },
      { name: "rebuilderCount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "isReproduced",
    stateMutability: "view",
    inputs: [{ name: "codeHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Map a scan attestation to the on-chain enum. */
export function toOnChainVerdict(a: string): number {
  switch (a) {
    case "SIMULATED":
      return VERDICT.SIMULATED;
    case "NO_KNOWN_SOURCE":
      return VERDICT.NO_KNOWN_SOURCE;
    case "UNREPRODUCIBLE":
      return VERDICT.UNREPRODUCIBLE;
    case "DIVERGED":
      return VERDICT.DIVERGED;
    case "REPRODUCED":
      return VERDICT.REPRODUCED;
    default:
      return VERDICT.NONE;
  }
}

const log = (m: string): void => void process.stderr.write(`${m}\n`);

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const key = (process.env.PRIVATE_KEY ??
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

  const deployed = JSON.parse(
    readFileSync(join(HERE, "..", "out", "deployed.local.json"), "utf8"),
  ) as { reproRegistry: Address };
  const scan = JSON.parse(readFileSync(join(HERE, "..", "out", "scan.json"), "utf8")) as ScanResult;

  const chain = defineChain({
    id: 114,
    name: "Coston2 (fork)",
    nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  // One assessment per DISTINCT code hash, not per machine. 223 machines share
  // 8 images; writing 223 times would be 215 redundant transactions asserting
  // the identical fact.
  const byHash = new Map<string, { attestation: string; machines: number }>();
  for (const m of scan.machines) {
    const e = byHash.get(m.codeHash) ?? { attestation: m.attestation, machines: 0 };
    e.machines++;
    byHash.set(m.codeHash, e);
  }

  log(`registry ${deployed.reproRegistry}`);
  log(`publishing ${byHash.size} distinct code hashes (covering ${scan.machines.length} machines)`);

  let n = 0;
  for (const [codeHash, { attestation, machines }] of byHash) {
    const verdict = toOnChainVerdict(attestation);
    const hash = await wallet.writeContract({
      address: deployed.reproRegistry,
      abi: registryAbi,
      functionName: "assess",
      args: [codeHash as Hex, verdict, `0x${"0".repeat(64)}` as Hex, ""],
    });
    await pub.waitForTransactionReceipt({ hash });
    log(`  ${(++n).toString().padStart(2)}. ${codeHash.slice(0, 14)}… ${attestation.padEnd(16)} ${machines} machine(s)`);
  }

  // Read every one back. A write that cannot be read back is not a record.
  log("\nverifying reads:");
  let mismatches = 0;
  for (const [codeHash, { attestation }] of byHash) {
    const [v] = await pub.readContract({
      address: deployed.reproRegistry,
      abi: registryAbi,
      functionName: "reproStatus",
      args: [codeHash as Hex],
    });
    const expected = toOnChainVerdict(attestation);
    const ok = Number(v) === expected;
    if (!ok) mismatches++;
    log(`  ${ok ? "OK  " : "FAIL"} ${codeHash.slice(0, 14)}… on-chain=${v} expected=${expected}`);
  }

  // Nothing in this corpus has been rebuilt against its chain hash, so nothing
  // may report as reproduced. Asserting the negative is the point.
  const anyReproduced = (
    await Promise.all(
      [...byHash.keys()].map((h) =>
        pub.readContract({
          address: deployed.reproRegistry,
          abi: registryAbi,
          functionName: "isReproduced",
          args: [h as Hex],
        }),
      ),
    )
  ).some(Boolean);

  log(`\nmismatches:     ${mismatches}`);
  log(`any REPRODUCED: ${anyReproduced} (must be false — none were rebuilt against their chain hash)`);

  if (mismatches > 0 || anyReproduced) {
    log("E2E FAILED");
    process.exit(1);
  }
  log("E2E OK");
}

main().catch((e: unknown) => {
  log(`publish failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
