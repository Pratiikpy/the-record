/**
 * publish — carry a CV-1 conclusion onto chain, and prove the lapse mechanism.
 *
 * The interesting assertion here is not that a CLEAN period records. It is that
 * a period a reporter STAYS SILENT about becomes adverse anyway, written by a
 * stranger. Suppression is the real attack on an assurance register — a subject
 * can withhold a bad conclusion, but it cannot manufacture a good one on time —
 * so the E2E exercises that path explicitly rather than only the happy one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Cv1Report } from "./cv1.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_OUT = join(HERE, "..", "..", "..", "contracts", "out");
const CV1 = join(HERE, "..", "out", "cv1.json");

/** Mirrors AssuranceRegistry.Opinion. */
export const OPINION = { NONE: 0, CLEAN: 1, EXCEPTION: 2, DISCLAIMER: 3, LAPSED: 4 } as const;

export function toOnChainOpinion(o: string): number {
  switch (o) {
    case "CLEAN":
      return OPINION.CLEAN;
    case "EXCEPTION":
      return OPINION.EXCEPTION;
    case "DISCLAIMER":
      return OPINION.DISCLAIMER;
    default:
      return OPINION.NONE;
  }
}

const log = (m: string): void => void process.stderr.write(`${m}\n`);

const PERIOD_LENGTH = 86_400n; // one day
const GRACE = 21_600n; // six hours

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const key = (process.env.PRIVATE_KEY ??
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
  /** anvil account #1 — a stranger, to prove lapse() is permissionless */
  const strangerKey =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

  const report = JSON.parse(readFileSync(CV1, "utf8")) as Cv1Report;
  const artifact = JSON.parse(
    readFileSync(join(CONTRACTS_OUT, "AssuranceRegistry.sol", "AssuranceRegistry.json"), "utf8"),
  ) as { abi: Abi; bytecode: { object: Hex } };

  const chain = defineChain({
    id: 114,
    name: "Coston2 (fork)",
    nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(key);
  const stranger = privateKeyToAccount(strangerKey);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const strangerWallet = createWalletClient({ account: stranger, chain, transport: http(rpc) });

  // Fresh deploy: an append-only register carries state forward, so a run that
  // depends on what happened last time is not a test.
  const deployHash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [account.address],
  });
  const registry = (await pub.waitForTransactionReceipt({ hash: deployHash }))
    .contractAddress as Address;
  log(`AssuranceRegistry ${registry}`);

  const abi = artifact.abi;
  const codeHash = keccak256(toHex(`cv-1:${report.procedureId}`));
  const manifestHash = keccak256(toHex(JSON.stringify(report.controls.map((c) => c.assertion))));
  const subject = "0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b" as Address; // CoreVaultManager

  const regHash = await wallet.writeContract({
    address: registry,
    abi,
    functionName: "registerProcedure",
    args: [codeHash, subject, manifestHash, PERIOD_LENGTH, GRACE],
  });
  await pub.waitForTransactionReceipt({ hash: regHash });

  const id = (await pub.readContract({
    address: registry,
    abi,
    functionName: "procedureId",
    args: [codeHash, subject],
  })) as Hex;
  log(`procedure ${id}`);

  let failures = 0;
  const check = (ok: boolean, label: string): void => {
    if (!ok) failures++;
    log(`  ${ok ? "OK  " : "FAIL"} ${label}`);
  };

  // ---- 1. the real conclusion records ---------------------------------------
  const opinion = toOnChainOpinion(report.opinion);
  const exceptionCount = report.controls.reduce((n, c) => n + c.exceptions.length, 0);
  const evidenceDigest = keccak256(toHex(report.evidence.evidenceDigest));

  const cHash = await wallet.writeContract({
    address: registry,
    abi,
    functionName: "conclude",
    args: [id, 0n, opinion, evidenceDigest, exceptionCount],
  });
  await pub.waitForTransactionReceipt({ hash: cHash });

  const c0 = (await pub.readContract({
    address: registry,
    abi,
    functionName: "conclusionOf",
    args: [id, 0n],
  })) as { opinion: number; evidenceDigest: Hex; exceptionCount: number };
  check(Number(c0.opinion) === opinion, `period 0 recorded ${report.opinion} (${opinion})`);
  check(c0.evidenceDigest === evidenceDigest, "evidence digest round-trips");

  // ---- 2. a period cannot be concluded twice --------------------------------
  let doubleWriteRejected = false;
  try {
    await pub.simulateContract({
      account,
      address: registry,
      abi,
      functionName: "conclude",
      args: [id, 0n, OPINION.CLEAN, evidenceDigest, 0],
    });
  } catch {
    doubleWriteRejected = true;
  }
  check(doubleWriteRejected, "a concluded period cannot be overwritten");

  // ---- 3. silence becomes the record ----------------------------------------
  // Advance past period 1 plus its grace, conclude nothing, and let a STRANGER
  // write the adverse record.
  await pub.request({
    method: "evm_increaseTime" as never,
    params: [Number(PERIOD_LENGTH * 3n + GRACE + 10n)] as never,
  });
  await pub.request({ method: "evm_mine" as never, params: [] as never });

  const lapseHash = await strangerWallet.writeContract({
    address: registry,
    abi,
    functionName: "lapse",
    args: [id, 1n],
  });
  await pub.waitForTransactionReceipt({ hash: lapseHash });

  const c1 = (await pub.readContract({
    address: registry,
    abi,
    functionName: "conclusionOf",
    args: [id, 1n],
  })) as { opinion: number; reporter: Address };
  check(Number(c1.opinion) === OPINION.LAPSED, "an unreported period lapses");
  check(
    c1.reporter.toLowerCase() === stranger.address.toLowerCase(),
    "lapse() is permissionless — a stranger wrote it",
  );

  // ---- 4. coverage separates unknown from clean -----------------------------
  const [concluded, clean, adverse, missing] = (await pub.readContract({
    address: registry,
    abi,
    functionName: "coverage",
    args: [id, 0n, 3n],
  })) as [bigint, bigint, bigint, bigint];

  log(`\ncoverage 0..3 → concluded=${concluded} clean=${clean} adverse=${adverse} missing=${missing}`);
  check(adverse >= 1n, "the lapsed period counts as adverse, never as clean");
  check(missing === 2n, "periods 2 and 3 read as missing, which is not clean");

  if (failures > 0) {
    log("\nE2E FAILED");
    process.exit(1);
  }
  log("\nE2E OK");
}

main().catch((e: unknown) => {
  log(`publish failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
