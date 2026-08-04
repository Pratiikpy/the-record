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
import {
  rebuild,
  assertContainerDriver,
  guaranteeFor,
  scopeOf,
  type RebuildOutcome,
  type Scoped,
} from "./rebuild.js";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "rebuilds.json");

const log = (m: string): void => void process.stderr.write(`${m}\n`);

/**
 * The standing corpus: Flare's own published images. Chosen because their
 * source, tags and recipe are all public, so a third party can check our work
 * on exactly the same inputs.
 */
/**
 * Refs and paths verified against the live repos, not assumed. The first corpus
 * run failed four of five targets on inputs that looked obviously right:
 *   - tee-proxy has no v0.0.24; its latest tag is v0.0.21
 *   - fce-extension-scaffold's only tag (v0.20) predates the per-language
 *     layout entirely and ships a single root Dockerfile
 * The multi-language paths therefore only exist on the default branch, which is
 * a moving target — so it is pinned to a resolved commit at run time.
 */
export const TARGETS = [
  { repo: "flare-foundation/tee-node", ref: "v0.0.24", dockerfile: "Dockerfile", lang: "Go" },
  { repo: "flare-foundation/tee-proxy", ref: "v0.0.21", dockerfile: "Dockerfile", lang: "Go" },
  {
    repo: "flare-foundation/fce-extension-scaffold",
    ref: "v0.20",
    dockerfile: "Dockerfile",
    lang: "Go",
  },
  // Per-language images exist only on the default branch. Python and TypeScript
  // are declared same-machine-only, so they exercise the scoping path that
  // stops a green local build being presented as independent verification.
  {
    repo: "flare-foundation/fce-extension-scaffold",
    ref: "HEAD",
    dockerfile: "python/Dockerfile",
    lang: "Python",
  },
  {
    repo: "flare-foundation/fce-extension-scaffold",
    ref: "HEAD",
    dockerfile: "typescript/Dockerfile",
    lang: "TypeScript",
  },
] as const;

interface Record_ {
  repo: string;
  ref: string;
  dockerfile: string;
  lang: string;
  outcome: RebuildOutcome;
  scope: Scoped;
  startedAt: string;
  seconds: number;
}

/**
 * Fetch a repo's REPRODUCIBILITY.md at a ref, so the guarantee is read from the
 * source rather than hardcoded here. raw.githubusercontent does not understand
 * the literal "HEAD", so it is mapped to the default branch.
 */
function fetchReproducibilityMd(repo: string, ref: string): string {
  const refs = ref === "HEAD" ? ["main", "master"] : [ref];
  for (const r of refs) {
    for (const path of ["REPRODUCIBILITY.md", "docs/REPRODUCIBILITY.md"]) {
      try {
        const body = execFileSync(
          "curl",
          ["-sfL", `https://raw.githubusercontent.com/${repo}/${r}/${path}`],
          { encoding: "utf8", timeout: 30_000 },
        );
        if (body.trim()) return body;
      } catch {
        // try the next location
      }
    }
  }
  return "";
}

async function one(
  t: { repo: string; ref: string; dockerfile: string; lang: string },
  expected?: string,
): Promise<Record_> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const scope = scopeOf(guaranteeFor(fetchReproducibilityMd(t.repo, t.ref), t.lang));
  log(`\n── ${t.repo}@${t.ref} · ${t.dockerfile} (${t.lang}) ──`);
  log(`   declared: ${scope.guarantee}${scope.independentlyVerifiable ? "" : " — NOT independently verifiable"}`);

  const outcome = await rebuild({
    repo: t.repo,
    ref: t.ref,
    dockerfile: t.dockerfile,
    double: true,
    ...(expected ? { expected } : {}),
  });
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  log(
    `   ${outcome.status}${"digest" in outcome ? ` ${outcome.digest}` : ""}${"reason" in outcome ? ` — ${outcome.reason}` : ""} (${seconds}s)`,
  );
  if (!scope.independentlyVerifiable && outcome.status === "DETERMINISTIC") {
    log(`   ⚠ same-host only: ${scope.caveat}`);
  }
  return { ...t, outcome, scope, startedAt, seconds };
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
