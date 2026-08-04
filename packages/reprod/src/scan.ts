/**
 * reprod scan — enumerate every active TEE machine on Coston2 and record,
 * for each, what the chain says it is and whether it is actually there.
 *
 * Reads only. No keys, no funds, no permission from anyone. Everything here is
 * re-derivable by any third party from public RPC.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address } from "viem";

import { client, FLARE_TEE_MANAGER, teeAbi, bytes32ToString, statusName } from "./chain.js";
import { probeAll } from "./liveness.js";
import { classifyAttestation, assessUrl, severity, type Attestation, type Liveness } from "./verdict.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out", "scan.json");
const PAGE = 200;

export interface MachineRow {
  teeId: Address;
  initialTeeId: Address;
  owner: Address;
  extensionId: string;
  url: string;
  host: string;
  ephemeral: boolean;
  ephemeralReason?: string;
  insecure: boolean;
  codeHash: string;
  platform: string;
  status: string;
  attestation: Attestation;
  liveness: Liveness;
  probeMs?: number;
  probeStatus?: number;
  probeError?: string;
  /** proxy's own claim about its code hash — compared, never trusted */
  selfReportedCodeHash?: string;
  /**
   * MATCHES / MISMATCH are only asserted when exactly one machine is registered
   * at this URL. With several machines behind one proxy the /info response
   * cannot be attributed to any one of them, so the comparison is AMBIGUOUS.
   */
  selfReport: "MATCHES" | "MISMATCH" | "AMBIGUOUS" | "NONE";
  machinesOnThisUrl: number;
  severity: number;
}

export interface ScanResult {
  scannedAt: string;
  chainId: number;
  blockNumber: string;
  registry: Address;
  platforms: string[];
  nextPublicExtensionId: string;
  totalActiveMachines: number;
  machines: MachineRow[];
  summary: {
    byAttestation: Record<string, number>;
    byLiveness: Record<string, number>;
    uniqueUrls: number;
    ephemeralUrls: number;
    insecureUrls: number;
    distinctCodeHashes: number;
    distinctExtensions: number;
    selfReport: Record<string, number>;
  };
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const base = { address: FLARE_TEE_MANAGER, abi: teeAbi } as const;

  const [blockNumber, platformsRaw, nextExtId] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ ...base, functionName: "getSystemSupportedPlatforms" }),
    client.readContract({ ...base, functionName: "nextPublicExtensionId" }),
  ]);
  log(`chain 114 @ block ${blockNumber}`);

  // ---- 1. read the active machine set ---------------------------------------
  //
  // NB: getAllActiveTeeMachines(start, count) does NOT paginate the way the
  // signature suggests — calling it with start=200 returns an empty array even
  // though total is 223. Verified against the live contract. So: probe once for
  // the total, then ask for the whole set in a single call from start=0.
  const [, , total] = await client.readContract({
    ...base,
    functionName: "getAllActiveTeeMachines",
    args: [0n, 1n],
  });

  const [teeIds, urls, totalConfirmed] = await client.readContract({
    ...base,
    functionName: "getAllActiveTeeMachines",
    args: [0n, total + BigInt(PAGE)],
  });

  if (BigInt(teeIds.length) !== totalConfirmed) {
    throw new Error(
      `machine set incomplete: got ${teeIds.length} of ${totalConfirmed} — refusing to publish a partial scan`,
    );
  }
  log(`  ${teeIds.length} active machines (total ${totalConfirmed})`);

  // ---- 2. per-machine chain facts (batched over JSON-RPC) --------------------
  log(`reading attestation data for ${teeIds.length} machines…`);
  const facts = await Promise.all(
    teeIds.map(async (teeId) => {
      const [att, status, extensionId, owner] = await Promise.all([
        client.readContract({ ...base, functionName: "getTeeMachineWithAttestationData", args: [teeId] }),
        client.readContract({ ...base, functionName: "getTeeMachineStatus", args: [teeId] }),
        client.readContract({ ...base, functionName: "getExtensionId", args: [teeId] }),
        client.readContract({ ...base, functionName: "getTeeMachineOwner", args: [teeId] }),
      ]);
      return { teeId, att, status, extensionId, owner };
    }),
  );

  // ---- 3. liveness, deduplicated by URL --------------------------------------
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  log(`probing ${uniqueUrls.length} unique proxy URLs…`);
  const probes = await probeAll(uniqueUrls, (done, n) => {
    if (done % 10 === 0 || done === n) log(`  probed ${done}/${n}`);
  });

  // How many machines sit behind each URL. A proxy serves ONE /info, so when
  // several machines share a URL we cannot attribute that response to any one
  // of them — comparing it to each machine's own on-chain hash would
  // manufacture false mismatches. Those are reported as AMBIGUOUS, never as
  // drift. Only a 1:1 URL→machine mapping yields a usable comparison.
  const machinesPerUrl = new Map<string, number>();
  for (const f of facts) machinesPerUrl.set(f.att.url, (machinesPerUrl.get(f.att.url) ?? 0) + 1);

  // ---- 4. classify -----------------------------------------------------------
  const machines: MachineRow[] = facts.map(({ teeId, att, status, extensionId, owner }) => {
    const url = att.url;
    const u = assessUrl(url);
    const probe = probes.get(url);
    const liveness: Liveness = probe ? (probe.ok ? "LIVE" : "DEAD") : "UNCHECKED";
    const attestation = classifyAttestation({ codeHash: att.codeHash, platformRaw: att.platform });
    const selfReportedCodeHash = probe?.selfReportedCodeHash;
    const soleOccupant = (machinesPerUrl.get(url) ?? 0) === 1;

    return {
      teeId,
      initialTeeId: att.initialTeeId,
      owner,
      extensionId: extensionId.toString(),
      url,
      host: u.host,
      ephemeral: u.ephemeral,
      ephemeralReason: u.reason,
      insecure: u.insecure,
      codeHash: att.codeHash,
      platform: bytes32ToString(att.platform),
      status: statusName(Number(status)),
      attestation,
      liveness,
      probeMs: probe?.ms,
      probeStatus: probe?.status,
      probeError: probe?.error,
      selfReportedCodeHash,
      selfReport:
        selfReportedCodeHash === undefined
          ? "NONE"
          : !soleOccupant
            ? "AMBIGUOUS"
            : selfReportedCodeHash.toLowerCase() === att.codeHash.toLowerCase()
              ? "MATCHES"
              : "MISMATCH",
      machinesOnThisUrl: machinesPerUrl.get(url) ?? 0,
      severity: severity(attestation, liveness),
    };
  });

  machines.sort((a, b) => a.severity - b.severity || a.host.localeCompare(b.host));

  const count = <T extends string>(xs: readonly T[]): Record<string, number> =>
    xs.reduce<Record<string, number>>((acc, x) => ((acc[x] = (acc[x] ?? 0) + 1), acc), {});

  const result: ScanResult = {
    scannedAt: new Date().toISOString(),
    chainId: 114,
    blockNumber: blockNumber.toString(),
    registry: FLARE_TEE_MANAGER,
    platforms: platformsRaw.map(bytes32ToString),
    nextPublicExtensionId: nextExtId.toString(),
    totalActiveMachines: Number(total),
    machines,
    summary: {
      byAttestation: count(machines.map((m) => m.attestation)),
      byLiveness: count(machines.map((m) => m.liveness)),
      uniqueUrls: uniqueUrls.length,
      ephemeralUrls: new Set(machines.filter((m) => m.ephemeral).map((m) => m.url)).size,
      insecureUrls: new Set(machines.filter((m) => m.insecure).map((m) => m.url)).size,
      distinctCodeHashes: new Set(machines.map((m) => m.codeHash)).size,
      distinctExtensions: new Set(machines.map((m) => m.extensionId)).size,
      selfReport: count(machines.map((m) => m.selfReport)),
    },
  };

  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  log(`\n─── scan complete in ${((Date.now() - t0) / 1000).toFixed(1)}s ───`);
  log(`machines            ${result.totalActiveMachines}`);
  log(`unique proxy URLs   ${result.summary.uniqueUrls}`);
  log(`ephemeral URLs      ${result.summary.ephemeralUrls}`);
  log(`insecure (http://)  ${result.summary.insecureUrls}`);
  log(`distinct codeHashes ${result.summary.distinctCodeHashes}`);
  log(`distinct extensions ${result.summary.distinctExtensions}`);
  log(`attestation         ${JSON.stringify(result.summary.byAttestation)}`);
  log(`liveness            ${JSON.stringify(result.summary.byLiveness)}`);
  log(`self-report         ${JSON.stringify(result.summary.selfReport)}`);
  log(`→ ${OUT}`);
}

main().catch((err: unknown) => {
  log(`scan failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
