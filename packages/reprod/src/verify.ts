/**
 * verify — rebuild declared source revisions and record the verdict.
 *
 * Usage:
 *   tsx src/verify.ts <repo> <ref> <dockerfile> [expectedCodeHash]
 *   tsx src/verify.ts --targets            # the standing Flare corpus
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rebuild, assertContainerDriver, type RebuildOutcome } from "./rebuild.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "rebuilds.json");

const log = (m: string): void => void process.stderr.write(`${m}\n`);

/**
 * The standing corpus: Flare's own published images. Chosen because their
 * source, tags and recipe are all public, so a third party can check our work
 * on exactly the same inputs.
 */
export const TARGETS = [
  { repo: "flare-foundation/tee-node", ref: "v0.0.24", dockerfile: "Dockerfile", lang: "Go" },
  { repo: "flare-foundation/tee-node", ref: "v0.0.23", dockerfile: "Dockerfile", lang: "Go" },
  { repo: "flare-foundation/tee-proxy", ref: "v0.0.24", dockerfile: "Dockerfile", lang: "Go" },
] as const;

interface Record_ {
  repo: string;
  ref: string;
  dockerfile: string;
  lang: string;
  outcome: RebuildOutcome;
  startedAt: string;
  seconds: number;
}

async function one(t: (typeof TARGETS)[number] | { repo: string; ref: string; dockerfile: string; lang: string }, expected?: string): Promise<Record_> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  log(`\n── ${t.repo}@${t.ref} (${t.lang}) ──`);
  const outcome = await rebuild({
    repo: t.repo,
    ref: t.ref,
    dockerfile: t.dockerfile,
    double: true,
    ...(expected ? { expected } : {}),
  });
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  log(`   ${outcome.status}${"digest" in outcome ? ` ${outcome.digest}` : ""}${"reason" in outcome ? ` — ${outcome.reason}` : ""} (${seconds}s)`);
  return { ...t, outcome, startedAt, seconds };
}

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });
  await assertContainerDriver();
  log("builder OK: docker-container driver (rewrite-timestamp honoured)");

  const argv = process.argv.slice(2);
  const records: Record_[] = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, "utf8")) as { rebuilds: Record_[] }).rebuilds
    : [];

  if (argv[0] === "--targets" || argv.length === 0) {
    for (const t of TARGETS) records.push(await one(t));
  } else {
    const [repo, ref, dockerfile, expected] = argv;
    if (!repo || !ref || !dockerfile) {
      log("usage: verify.ts <repo> <ref> <dockerfile> [expectedCodeHash] | --targets");
      process.exit(2);
    }
    records.push(await one({ repo, ref, dockerfile, lang: "unknown" }, expected));
  }

  const summary = records.reduce<Record<string, number>>(
    (a, r) => ((a[r.outcome.status] = (a[r.outcome.status] ?? 0) + 1), a),
    {},
  );

  writeFileSync(
    OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rebuilds: records }, null, 2)}\n`,
    "utf8",
  );
  log(`\nsummary ${JSON.stringify(summary)}`);
  log(`→ ${OUT}`);
}

main().catch((e: unknown) => {
  log(`verify failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
