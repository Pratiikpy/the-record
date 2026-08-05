/**
 * Deploy the contracts fresh from Foundry artefacts.
 *
 * The end-to-end run must start from a known-empty register. FailRecord is
 * append-only by design, so a partial write from an earlier run permanently
 * skews every count — the first E2E attempt failed with total=41 where 40 was
 * expected, purely because one row survived a crashed run. Redeploying is the
 * only honest reset: a test whose result depends on what happened last time is
 * not a test.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_OUT = join(HERE, "..", "..", "..", "contracts", "out");
const DEPLOYED = join(HERE, "..", "..", "reprod", "out", "deployed.local.json");

const log = (m: string): void => void process.stderr.write(`${m}\n`);

interface Artifact {
  abi: Abi;
  bytecode: { object: Hex };
}

function artifact(name: string): Artifact {
  return JSON.parse(readFileSync(join(CONTRACTS_OUT, `${name}.sol`, `${name}.json`), "utf8")) as Artifact;
}

/**
 * Refuse a chain that will never confirm the transactions this script sends.
 *
 * This deploys to 127.0.0.1:8545 and waits for receipts. A `--no-mining` anvil
 * left behind by an earlier red run was holding that port, so the deploy sat
 * there until viem timed out minutes later reporting
 * "WaitForTransactionReceiptTimeoutError" -- a message about the symptom that
 * says nothing about the cause. redrun.ts already refuses a chain whose state
 * it does not know; the same discipline belongs here.
 *
 * Getting the PROBE right took three attempts, and the wrong two are why this
 * comment is long:
 *
 *   1. Compare block height either side of an `evm_mine`. viem memoises
 *      getBlockNumber for its polling interval, so both reads returned the same
 *      cached height and every healthy chain was declared dead. A preflight
 *      that refuses every deploy is worse than the hang it replaced.
 *   2. The same, with `cacheTime: 0`. But `evm_mine` mines ON DEMAND even when
 *      automining is off, so a --no-mining anvil sailed through and hung
 *      exactly as before -- a guard that passes the one case it exists for.
 *
 * The actual question is not "can this chain produce a block" but "will it
 * produce one without being asked", and anvil answers that directly. A chain
 * that does not implement the method is a real network, which mines on its own
 * schedule and needs no check.
 */
async function requireMiningChain(
  pub: { getChainId: () => Promise<number> },
  rpc: string,
): Promise<void> {
  let chainId: number;
  try {
    chainId = await pub.getChainId();
  } catch {
    throw new Error(
      `nothing is serving JSON-RPC at ${rpc}. Start one (\`anvil --fork-url <coston2>\`) or set RPC_URL.`,
    );
  }

  let automine: unknown;
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_getAutomine", params: [] }),
    });
    automine = ((await res.json()) as { result?: unknown }).result;
  } catch {
    return; // unreachable mid-probe is not our failure to diagnose
  }

  // undefined => not a dev node => it mines on its own schedule.
  if (automine === false) {
    throw new Error(
      `the chain at ${rpc} (id ${chainId}) has automining disabled, so a deploy would hang ` +
        "until the receipt wait times out. It is most likely an anvil started with --no-mining " +
        "by an earlier red run. Stop it, or point RPC_URL elsewhere.",
    );
  }
}

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const key = (process.env.PRIVATE_KEY ??
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

  const chain = defineChain({
    id: 114,
    name: "Coston2 (fork)",
    nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  await requireMiningChain(pub, rpc);

  const out: Record<string, string> = { rpc, deployer: account.address };

  for (const [name, field] of [
    ["ReproRegistry", "reproRegistry"],
    ["FailRecord", "failRecord"],
  ] as const) {
    const a = artifact(name);
    const hash = await wallet.deployContract({
      abi: a.abi,
      bytecode: a.bytecode.object,
      args: [account.address],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress as Address;
    out[field] = address;
    log(`${name.padEnd(14)} ${address}`);
  }

  writeFileSync(DEPLOYED, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  log(`→ ${DEPLOYED}`);
}

main().catch((e: unknown) => {
  log(`deploy failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
