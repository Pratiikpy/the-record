/**
 * `provenance` — turn 32 bytes into a fact, from anyone's terminal.
 *
 * The confidential-compute trust model is one sentence: *check the code hash.*
 * This is the missing second half of that sentence. Give it a hash, an
 * extension id, a TEE address, or a live machine URL, and it answers what the
 * hash actually establishes — and, always, what it does not.
 *
 * It runs against a committed registry snapshot by default, with no network at
 * all, so the answer is re-derivable by a stranger who does not trust our
 * server and does not want to wait for an RPC. `--live` re-reads the registry
 * from Coston2 instead, which is slower and can fail, and is therefore never
 * the path a demo depends on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  hashProvenance,
  indexRegistry,
  summarise,
  type Provenance,
  type RebuildEvidence,
  type RegistryEntry,
} from "./provenance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN = join(HERE, "..", "out", "scan.json");
const REBUILDS = join(HERE, "..", "out", "rebuilds.json");

interface ScanFile {
  scannedAt: string;
  chainId: number;
  blockNumber: number;
  registry: string;
  totalActiveMachines: number;
  machines: Array<
    RegistryEntry & { teeId: string; url: string; attestation: string; liveness: string }
  >;
}

interface RebuildFile {
  rebuilds: Array<{
    repo: string;
    ref: string;
    dockerfile: string;
    outcome: { status: string; digest?: string; expected?: string };
    scope: { guarantee: string };
  }>;
}

const out = (s = ""): void => void process.stdout.write(`${s}\n`);

/** ANSI, but only when a human is looking. Piped output stays plain. */
const tty = process.stdout.isTTY === true;
const dim = (s: string): string => (tty ? `[2m${s}[0m` : s);
const bold = (s: string): string => (tty ? `[1m${s}[0m` : s);

const VERDICT_COLOUR: Record<string, string> = {
  REPRODUCED: "[32m",
  DIVERGED: "[31m",
  NOT_A_MEASUREMENT: "[33m",
  UNREPRODUCIBLE: "[33m",
  NO_KNOWN_SOURCE: "[33m",
  UNKNOWN_HASH: "[2m",
};
const verdictTag = (v: string): string =>
  tty ? `${VERDICT_COLOUR[v] ?? ""}[ ${v} ][0m` : `[ ${v} ]`;

/** Wrap prose so a narrow terminal does not shred the explanation. */
function wrap(s: string, width = 76, indent = "  "): string {
  const words = s.split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

function loadRebuilds(): RebuildEvidence[] {
  let f: RebuildFile;
  try {
    f = JSON.parse(readFileSync(REBUILDS, "utf8")) as RebuildFile;
  } catch {
    return [];
  }
  // A DETERMINISTIC rebuild produced the same digest twice but was never
  // matched against an on-chain hash. Presenting it as evidence FOR a hash it
  // does not equal would be the overclaim this whole package exists to avoid,
  // so the digest is carried as its own key and matches only itself.
  return f.rebuilds
    .filter((r) => r.outcome.digest)
    .map((r) => ({
      codeHash: r.outcome.digest!,
      source: { repo: r.repo, commitSha: r.ref },
      digests: [r.outcome.digest!],
    }));
}

/**
 * Resolve whatever the user typed into a code hash.
 *
 * Accepts a code hash, an extension id, a TEE address, or a machine URL —
 * because a reader who wants to check a machine has whichever of those the
 * project happened to publish, and making them convert it by hand is where
 * "just check the hash" quietly becomes impossible.
 */
function resolve(
  query: string,
  scan: ScanFile,
): { codeHash: string; via: string } | { error: string } {
  const q = query.trim();
  const lower = q.toLowerCase();

  if (/^0x[0-9a-f]{64}$/u.test(lower)) return { codeHash: lower, via: "code hash" };

  if (/^\d+$/u.test(q)) {
    const m = scan.machines.find((x) => x.extensionId === q);
    return m
      ? { codeHash: m.codeHash.toLowerCase(), via: `extension ${q}` }
      : { error: `no machine in the snapshot has extension id ${q}` };
  }

  if (/^0x[0-9a-f]{40}$/u.test(lower)) {
    const m = scan.machines.find(
      (x) => x.teeId.toLowerCase() === lower || x.owner.toLowerCase() === lower,
    );
    return m
      ? { codeHash: m.codeHash.toLowerCase(), via: `address ${q}` }
      : { error: `no machine in the snapshot has TEE id or owner ${q}` };
  }

  if (/^https?:\/\//iu.test(q)) {
    const m = scan.machines.find((x) => x.url.replace(/\/+$/u, "") === q.replace(/\/+$/u, ""));
    return m
      ? { codeHash: m.codeHash.toLowerCase(), via: `machine at ${q}` }
      : { error: `no machine in the snapshot is registered at ${q}` };
  }

  return {
    error: `could not read "${q}" as a code hash, extension id, address, or URL`,
  };
}

function printCard(p: Provenance, via: string, scan: ScanFile): void {
  out();
  out(`  ${verdictTag(p.verdict)}  ${dim(via)}`);
  out(`  ${dim(p.codeHash)}`);
  out();

  if (p.identifyingBits !== null) {
    const share = ((p.registrations / scan.totalActiveMachines) * 100).toFixed(1);
    out(
      `  ${bold(String(p.identifyingBits))} bits of identification  ` +
        dim(`· ${p.registrations}/${scan.totalActiveMachines} machines (${share}%) · ` +
          `${p.distinctOwners} owner${p.distinctOwners === 1 ? "" : "s"} · ${p.platforms.join(", ")}`),
    );
    out();
  }

  out(`  ${bold("because")}`);
  out(wrap(p.because));
  out();
  out(`  ${bold("does not establish")}`);
  out(dim(wrap(p.doesNotEstablish)));
  if (p.source) {
    out();
    out(`  ${bold("source")}  ${p.source.repo}@${p.source.commitSha}`);
  }
  out();
}

function printRegistry(scan: ScanFile, rebuilds: RebuildEvidence[]): void {
  const idx = indexRegistry(scan.machines);
  const s = summarise(idx);
  const onChain = new Set([...idx.byHash.keys()]);
  const traceable = rebuilds.filter((r) => onChain.has(r.codeHash.toLowerCase())).length;

  out();
  out(`  ${bold("Flare TEE registry")}  ${dim(`chain ${scan.chainId} · block ${scan.blockNumber} · ${scan.scannedAt}`)}`);
  out(`  ${dim(scan.registry)}`);
  out();
  out(`  machines                 ${bold(String(s.total))}`);
  out(`  distinct code hashes     ${bold(String(s.distinctHashes))}`);
  out(`  mean identification      ${bold(`${s.meanIdentifyingBits} bits`)}  ${dim(`(a unique hash here would carry ${(Math.round(-Math.log2(1 / s.total) * 100) / 100).toFixed(2)})`)}`);
  out();

  if (s.mostShared) {
    const share = ((s.mostShared.registrations / s.total) * 100).toFixed(1);
    out(`  ${bold("most-shared hash")}`);
    out(`  ${dim(s.mostShared.codeHash)}`);
    out(
      `  carried by ${bold(String(s.mostShared.registrations))} machines (${share}%) under ` +
        `${bold(String(s.mostShared.distinctOwners))} independent owners → ${bold(`${s.mostShared.bits} bits`)}`,
    );
    out();
  }

  out(`  ${bold("rebuilds we performed")}      ${rebuilds.length}`);
  out(`  ${bold("that match an on-chain hash")} ${traceable}`);
  out();
  out(
    dim(
      wrap(
        traceable === 0
          ? "No machine in this registry carries a code hash that can currently be traced to " +
              "source: the shared value identifies nothing, and every distinctive hash has no " +
              "claimed source revision. The instruction to check the hash has no answer yet — " +
              "which is a statement about a registry three weeks into its life, not about anyone in it."
          : `${traceable} on-chain hash(es) rebuild from published source.`,
        76,
        "  ",
      ),
    ),
  );
  out();
}

function usage(): void {
  out();
  out(`  ${bold("provenance")} — what does a Flare TEE code hash actually establish?`);
  out();
  out("  provenance <hash|extensionId|address|url>   verdict for one machine");
  out("  provenance --registry                       the whole registry, measured");
  out("  provenance --json <query>                   machine-readable");
  out();
  out(dim("  Runs against a committed snapshot. No network, no server, no trust in us."));
  out();
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }

  const scan = JSON.parse(readFileSync(SCAN, "utf8")) as ScanFile;
  const rebuilds = loadRebuilds();
  const json = argv.includes("--json");
  const args = argv.filter((a) => !a.startsWith("--"));

  if (argv.includes("--registry")) {
    const idx = indexRegistry(scan.machines);
    if (json) out(JSON.stringify(summarise(idx), null, 2));
    else printRegistry(scan, rebuilds);
    return;
  }

  const query = args[0];
  if (query === undefined) {
    usage();
    process.exitCode = 2;
    return;
  }

  const r = resolve(query, scan);
  if ("error" in r) {
    process.stderr.write(`${r.error}\n`);
    process.exitCode = 2;
    return;
  }

  const p = hashProvenance(r.codeHash, indexRegistry(scan.machines), rebuilds);
  if (json) out(JSON.stringify(p, null, 2));
  else printCard(p, r.via, scan);
}

main();
