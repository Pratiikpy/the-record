/**
 * Collect every figure the film states, from the registers that produced them.
 *
 * A submission video is the single most tempting place to type a number by
 * hand: it is rendered once, nobody diffs it, and a stale frame looks exactly
 * like a fresh one. This project has already shipped that defect twice in
 * HTML — "Six errata" over a register of seven, and 223 machines while the
 * chain held 250 — so the film gets the same treatment as the pages.
 *
 * Written to public/facts.json at build time. If a register moves, the next
 * render moves with it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "..", "public", "facts.json");

const read = <T,>(p: string): T | null =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;

interface Machine { codeHash: string; owner: string; attestation: string; liveness: string }

const scan = read<{ totalActiveMachines: number; machines: Machine[] }>(
  join(ROOT, "packages/reprod/out/scan.json"),
);
const cv1 = read<{ opinion: string; controls: Array<{ id: string; title: string; opinion: string }>;
  network?: { label: string }; evidence: { flareBlock?: number; xrplLedger?: number } }>(
  join(ROOT, "packages/procedure/out/cv1.json"),
);
const green = read<{ opinion: string; controls: Array<{ id: string; opinion: string }> }>(
  join(ROOT, "packages/procedure/out/cv1-fork-green.json"),
);
const red = read<{ opinion: string; controls: Array<{ id: string; title: string; opinion: string; detail?: string }> }>(
  join(ROOT, "packages/procedure/out/cv1-fork-red.json"),
);
const suite = read<{ typescript: number; solidity: number; total: number }>(
  join(ROOT, "site/api/suite.json"),
);
const redemptions = read<{ totals: { redemptionsRequested: number; withNamedExecutorPct: number } }>(
  join(ROOT, "packages/covenant/out/redemptions.json"),
);
const overdue = read<{ totals: { examined: number; pending: number } }>(
  join(ROOT, "packages/covenant/out/overdue.json"),
);
const backfill = read<{ slots: number; rows: Array<{ opinion: string }>; network?: { label: string } }>(
  join(ROOT, "packages/procedure/out/backfill.json"),
);
const faults = read<{ faults: unknown[]; knownUncaught: unknown[] }>(join(ROOT, "site/spec/faults.json"));

// The errata module is TypeScript; parse the counts out of it rather than
// importing across package boundaries at build time.
const errataSrc = readFileSync(join(ROOT, "packages/design/src/errata.ts"), "utf8");
const errataTotal = (errataSrc.match(/id: "E-\d+"/gu) ?? []).length;
const errataPublished = (errataSrc.match(/fate: "PUBLISHED"/gu) ?? []).length;

function sharedHash(): { count: number; owners: number; bits: number; pct: string; total: number } {
  const ms = scan?.machines ?? [];
  const by = new Map<string, string[]>();
  for (const m of ms) by.set(m.codeHash, [...(by.get(m.codeHash) ?? []), m.owner.toLowerCase()]);
  let owners: string[] = [];
  for (const [, os] of by) if (os.length > owners.length) owners = os;
  const total = scan?.totalActiveMachines || ms.length || 1;
  return {
    count: owners.length,
    owners: new Set(owners).size,
    bits: Math.round(-Math.log2(owners.length / total) * 100) / 100 + 0,
    pct: ((owners.length / total) * 100).toFixed(1),
    total,
  };
}

const sh = sharedHash();
const facts = {
  generatedAt: new Date().toISOString(),
  network: cv1?.network?.label ?? "Flare mainnet",
  cv1: {
    opinion: cv1?.opinion ?? "—",
    controls: (cv1?.controls ?? []).map((c) => ({ id: c.id, title: c.title, opinion: c.opinion })),
    flareBlock: cv1?.evidence.flareBlock ?? null,
    xrplLedger: cv1?.evidence.xrplLedger ?? null,
  },
  redrun: {
    greenOpinion: green?.opinion ?? "—",
    redOpinion: red?.opinion ?? "—",
    controls: (red?.controls ?? []).map((c) => ({ id: c.id, title: c.title, opinion: c.opinion })),
    firedDetail: red?.controls.find((c) => c.opinion === "EXCEPTION")?.detail ?? "",
  },
  reprod: sh,
  covenant: {
    indexed: redemptions?.totals.redemptionsRequested ?? 0,
    namedExecutorPct: redemptions?.totals.withNamedExecutorPct ?? 0,
    pastDue: overdue ? overdue.totals.examined - overdue.totals.pending : 0,
  },
  backfill: {
    slots: backfill?.slots ?? 0,
    clean: (backfill?.rows ?? []).filter((r) => r.opinion === "CLEAN").length,
    disclaimers: (backfill?.rows ?? []).filter((r) => r.opinion === "DISCLAIMER").length,
    exceptions: (backfill?.rows ?? []).filter((r) => r.opinion === "EXCEPTION").length,
    label: backfill?.network?.label ?? "Flare mainnet",
  },
  errata: { total: errataTotal, published: errataPublished },
  faults: { total: (faults?.faults ?? []).length, knownUncaught: (faults?.knownUncaught ?? []).length },
  suite: suite ?? { typescript: 0, solidity: 0, total: 0 },
};

writeFileSync(OUT, JSON.stringify(facts, null, 2) + "\n", "utf8");
process.stderr.write(
  `→ facts.json · ${facts.reprod.total} machines · CV-1 ${facts.cv1.opinion} · ` +
    `redrun ${facts.redrun.greenOpinion}→${facts.redrun.redOpinion} · ${facts.suite.total} tests\n`,
);
