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
