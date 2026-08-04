/**
 * rebuild — independently rebuild a declared source revision and compare the
 * resulting image digest against what is registered on chain.
 *
 * The recipe is not invented here. It is Flare's own, from tee-node and
 * fce-extension-scaffold `REPRODUCIBILITY.md`:
 *
 *   docker buildx build --builder <docker-container driver> --platform linux/amd64
 *     --no-cache --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
 *     --output type=docker,rewrite-timestamp=true
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *   1. The DEFAULT docker driver silently does not honour `rewrite-timestamp`
 *      (moby/buildkit#4230). Building with it produces a digest that differs
 *      run to run, which would read as DIVERGED and be pure noise. We refuse to
 *      run rather than emit that.
 *
 *   2. The identifier is the OCI image *config* digest — the value Confidential
 *      Space reports as `submods.container.image_id` and the registry stores as
 *      codeHash. `docker inspect .Id` returns it for the docker driver but its
 *      meaning shifts with the storage backend, so it is read explicitly.
 *
 * Flare also states plainly that only their Go images reproduce across
 * machines; Python and TypeScript are same-machine only. That is not our
 * failure to work around — it is reported as UNREPRODUCIBLE, which is exactly
 * the verdict the register exists to distinguish from DIVERGED.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

export const BUILDER = "moby-buildkit";

/**
 * Outcome vocabulary. The distinction between DETERMINISTIC and REPRODUCED is
 * not pedantry — it is the difference between "this source builds the same way
 * twice" and "this source builds the thing that is actually registered on
 * chain". Only the second is evidence about a running machine. Collapsing them
 * would let the register claim verification it never performed.
 */
export type RebuildOutcome =
  /** built twice, same digest, and it matches the on-chain codeHash */
  | { status: "REPRODUCED"; digest: string; expected: string }
  /** built twice, same digest, but no on-chain hash was supplied to compare */
  | { status: "DETERMINISTIC"; digest: string }
  /** built, but the digest does NOT match the on-chain codeHash */
  | { status: "DIVERGED"; digest: string; expected: string }
  /** two builds of the same commit on one host disagreed */
  | { status: "UNREPRODUCIBLE"; reason: string; digests?: string[] }
  | { status: "ERROR"; reason: string };

/**
 * What the SOURCE claims about its own reproducibility, and therefore the
 * strongest conclusion a verifier is entitled to draw.
 *
 * This axis exists because of a structural limit that is easy to paper over:
 * **one machine cannot detect cross-machine nondeterminism.** Building twice
 * on this host proves same-host determinism and nothing more. Flare documents
 * that their Python and TypeScript images are "same-machine only" — those will
 * pass a double-build here and still be unverifiable by an auditor elsewhere.
 *
 * So a single rebuilder can never, alone, establish that an image is
 * independently verifiable. That requires agreement between rebuilders on
 * different hardware, which is exactly why ReproRegistry counts distinct
 * rebuilders rather than storing a boolean.
 */
export type Guarantee =
  /** source asserts bit-for-bit reproducibility on any machine */
  | "CROSS_MACHINE"
  /** source asserts determinism only on the same host — not independently verifiable */
  | "SAME_MACHINE_ONLY"
  /** the source makes no reproducibility claim at all */
  | "UNDECLARED";

/** Scope of what a single verifier's result can support. */
export interface Scoped {
  guarantee: Guarantee;
  /**
   * True only when the declared guarantee permits a third party on different
   * hardware to reach the same digest. False for SAME_MACHINE_ONLY, whatever
   * this host observed.
   */
  independentlyVerifiable: boolean;
  /** Plain-language caveat carried into the register alongside the verdict. */
  caveat?: string;
}

export function scopeOf(guarantee: Guarantee): Scoped {
  switch (guarantee) {
    case "CROSS_MACHINE":
      return { guarantee, independentlyVerifiable: true };
    case "SAME_MACHINE_ONLY":
      return {
        guarantee,
        independentlyVerifiable: false,
        caveat:
          "source declares same-machine determinism only; a matching digest here says nothing about whether an auditor on other hardware could reproduce it",
      };
    case "UNDECLARED":
      return {
        guarantee,
        independentlyVerifiable: false,
        caveat: "source makes no reproducibility claim; scope of any match is unknown",
      };
  }
}

/**
 * Map a repo's declared reproducibility claim to a guarantee.
 *
 * Flare states this two different ways and both must be read, or a repo that
 * makes a strong claim gets scored UNDECLARED and the register understates it:
 *
 *   - fce-extension-scaffold publishes a per-language TABLE
 *     (`| **Go** | **Bit-for-bit across machines** |`)
 *   - tee-node states it in PROSE, with no table at all
 *     ("builds produce bit-for-bit identical image layers regardless of when
 *      or where they are built")
 *
 * The table wins when present, because it is per-language and therefore more
 * specific than a repo-wide sentence.
 */
export function guaranteeFor(reproducibilityMd: string, language: string): Guarantee {
  if (!reproducibilityMd.trim()) return "UNDECLARED";

  // 1. per-language table row — most specific
  const row = new RegExp(`\\|\\s*\\*\\*${language}\\*\\*\\s*\\|\\s*\\*\\*([^*|]+)\\*\\*`, "iu").exec(
    reproducibilityMd,
  );
  if (row) {
    const claim = row[1]!.toLowerCase();
    if (/bit-for-bit across machines/u.test(claim)) return "CROSS_MACHINE";
    if (/same-machine/u.test(claim)) return "SAME_MACHINE_ONLY";
  }

  // If the document publishes a per-language table at all, that table is the
  // authority. A language missing from it is UNDECLARED — falling through to
  // prose here would hand it a NEIGHBOURING language's guarantee, which is how
  // an unlisted runtime would silently inherit Python's caveat (or worse, Go's
  // promise). Absence of a row is absence of a claim.
  const hasLanguageTable = /\|\s*\*\*(Go|Python|TypeScript|Rust|Java|C\+\+)\*\*\s*\|/iu.test(
    reproducibilityMd,
  );
  if (hasLanguageTable) return "UNDECLARED";

  // 2. repo-wide prose claim, only when there is no table to consult
  const prose = reproducibilityMd.replace(/\s+/gu, " ").toLowerCase();
  if (/same-machine (determinism )?only/u.test(prose)) return "SAME_MACHINE_ONLY";
  if (
    /bit-for-bit identical[^.]*regardless of (when or )?where/u.test(prose) ||
    /bit-for-bit across machines/u.test(prose) ||
    /(identical|reproducible)[^.]*regardless of (when or )?where they are built/u.test(prose)
  ) {
    return "CROSS_MACHINE";
  }

  return "UNDECLARED";
}

export interface RebuildRequest {
  repo: string;
  /** tag or commit sha — resolved to an immutable sha before building */
  ref: string;
  dockerfile: string;
  /** the on-chain codeHash to compare against, if known */
  expected?: string;
  /** build twice and require agreement before claiming determinism */
  double?: boolean;
}

async function run(cmd: string, args: string[], cwd?: string, timeoutMs = 1_800_000) {
  return exec(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

/**
 * Refuse to proceed on the default driver. A build that silently ignores
 * rewrite-timestamp yields a meaningless digest, and a meaningless DIVERGED is
 * worse than no verdict at all.
 */
export async function assertContainerDriver(builder = BUILDER): Promise<void> {
  const { stdout } = await run("docker", ["buildx", "inspect", builder]);
  if (!/Driver:\s*docker-container/u.test(stdout)) {
    throw new Error(
      `builder "${builder}" is not on the docker-container driver; ` +
        "the default driver does not honour rewrite-timestamp (moby/buildkit#4230)",
    );
  }
}

/** Resolve a tag to the immutable commit it points at. */
export async function resolveRef(repo: string, ref: string): Promise<string> {
  const { stdout } = await run("git", ["ls-remote", `https://github.com/${repo}.git`, ref]);
  const sha = stdout.split(/\s+/u)[0];
  if (!sha || !/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`cannot resolve ${repo}@${ref}`);
  return sha;
}

/** The OCI image config digest — the value that becomes codeHash. */
async function imageConfigDigest(tag: string): Promise<string> {
  const { stdout } = await run("docker", ["image", "inspect", tag, "--format", "{{.Id}}"]);
  const id = stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/u.test(id)) throw new Error(`unexpected image id: ${id}`);
  return `0x${id.slice("sha256:".length)}`;
}

async function buildOnce(dir: string, dockerfile: string, epoch: string, tag: string): Promise<string> {
  await run("docker", [
    "buildx",
    "build",
    "--builder",
    BUILDER,
    "--platform",
    "linux/amd64",
    "--no-cache",
    "--build-arg",
    `SOURCE_DATE_EPOCH=${epoch}`,
    "--output",
    "type=docker,rewrite-timestamp=true",
    "-f",
    dockerfile,
    "-t",
    tag,
    ".",
  ], dir);
  return imageConfigDigest(tag);
}

export async function rebuild(req: RebuildRequest): Promise<RebuildOutcome> {
  let dir = "";
  try {
    await assertContainerDriver();
    const sha = await resolveRef(req.repo, req.ref);

    dir = mkdtempSync(join(tmpdir(), "reprod-"));
    await run("git", ["clone", "--quiet", `https://github.com/${req.repo}.git`, dir]);
    await run("git", ["checkout", "--quiet", sha], dir);

    const dfPath = join(dir, req.dockerfile);
    if (!existsSync(dfPath)) {
      return { status: "ERROR", reason: `dockerfile not found: ${req.dockerfile}` };
    }

    const { stdout: epochOut } = await run("git", ["log", "-1", "--format=%ct"], dir);
    const epoch = epochOut.trim();

    const tag = `reprod/${req.repo.replace("/", "-")}:${sha.slice(0, 12)}`;
    const first = await buildOnce(dir, req.dockerfile, epoch, tag);

    // Determinism is a claim about repeatability, so verify it rather than
    // assume it. Flare documents that only the Go path holds across machines.
    if (req.double) {
      const second = await buildOnce(dir, req.dockerfile, epoch, `${tag}-b`);
      if (second !== first) {
        return {
          status: "UNREPRODUCIBLE",
          reason: "two builds of the same commit on this host produced different digests",
          digests: [first, second],
        };
      }
    }

    // No on-chain hash to compare against: the strongest honest claim is that
    // the source builds deterministically, NOT that it matches anything.
    if (!req.expected) return { status: "DETERMINISTIC", digest: first };

    return first.toLowerCase() === req.expected.toLowerCase()
      ? { status: "REPRODUCED", digest: first, expected: req.expected }
      : { status: "DIVERGED", digest: first, expected: req.expected };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "ERROR", reason: msg.slice(0, 800) };
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // a leaked temp dir is not worth failing a verdict over
      }
    }
  }
}

/** Read the language-reproducibility table Flare publishes, if present. */
export function declaredGuarantee(repoDir: string): Record<string, string> {
  const p = join(repoDir, "REPRODUCIBILITY.md");
  if (!existsSync(p)) return {};
  const md = readFileSync(p, "utf8");
  const out: Record<string, string> = {};
  for (const m of md.matchAll(/\|\s*\*\*(Go|Python|TypeScript)\*\*\s*\|\s*\*\*([^*|]+)\*\*/gu)) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}
