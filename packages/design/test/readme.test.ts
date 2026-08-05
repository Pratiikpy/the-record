/**
 * The README is executable, or it is decoration.
 *
 * A judge's first action is to clone the repo and run the first command in
 * "Run it yourself". That command used to fail: the test suite reads rendered
 * pages, CI rendered them before testing, and the README did not. So CI knew a
 * precondition the published instruction did not carry, and the only person who
 * ever hit it was the reader — 4 failures and 82 silently skipped tests, under
 * a green badge.
 *
 * That is precisely the defect this project files against other people
 * (`REPRODUCIBILITY.md` documents a build nobody can follow), so it cannot be
 * shipped here. These tests bind the README to the manifest: every command it
 * prints must name a script that exists, and the entry command must carry its
 * own preconditions rather than assuming a warm tree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

const pkg = (name: string): { scripts?: Record<string, string> } =>
  JSON.parse(readFileSync(join(ROOT, "packages", name, "package.json"), "utf8"));

/** Every `pnpm --filter @therecord/<pkg> [run] <script>` the README prints. */
function documentedCommands(): Array<{ pkg: string; script: string }> {
  const out: Array<{ pkg: string; script: string }> = [];
  const re = /pnpm\s+--filter\s+@therecord\/([a-z]+)\s+(?:run\s+)?([a-z:]+)/gu;
  for (const m of README.matchAll(re)) out.push({ pkg: m[1]!, script: m[2]! });
  return out;
}

describe("every command the README prints is real", () => {
  const cmds = documentedCommands();

  it("finds the commands at all, so a rewrite cannot silently empty this suite", () => {
    // Without this, deleting the code block would make every test below vacuous.
    expect(cmds.length).toBeGreaterThanOrEqual(8);
  });

  it.each(cmds.map((c) => [`${c.pkg} → ${c.script}`, c] as const))(
    "%s exists in that package's manifest",
    (_label, c) => {
      const scripts = pkg(c.pkg).scripts ?? {};
      expect(
        Object.keys(scripts),
        `README documents \`pnpm --filter @therecord/${c.pkg} run ${c.script}\` but that package has no such script`,
      ).toContain(c.script);
    },
  );
});

describe("the entry command carries its own preconditions", () => {
  // `pnpm -r run test` is the first thing anyone runs. The packages whose tests
  // read rendered pages must build them, because a fresh clone has none and a
  // reader has no way to know that.
  it.each([
    ["design", "reads every rendered page for a11y and nav"],
    ["reprod", "parses the rendered stylesheet for contrast"],
  ])("%s renders before it tests — %s", (name) => {
    const scripts = pkg(name).scripts ?? {};
    expect(
      scripts.pretest,
      `${name}/package.json needs a "pretest" that renders, or a fresh clone fails the README's first command`,
    ).toBeTruthy();
    expect(scripts.pretest).toMatch(/render/u);
  });

  it("the render chain is defined once, at the root", () => {
    const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const chain = root.scripts?.["render:all"];
    expect(chain, 'root package.json must define "render:all"').toBeTruthy();
    // Every register that publishes a page has to be in it, or design's
    // cross-register link test is asserting against a stale tree.
    for (const p of ["covenant", "procedure", "reprod", "design"]) {
      expect(chain, `render:all omits ${p}`).toContain(p);
    }
  });

  it("CI and the README run the same entry command", () => {
    // CI used to render first and the README did not; that gap is the bug.
    const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("pnpm -r run test");
    expect(README).toContain("pnpm -r run test");
  });
});

describe("the README's own numbers", () => {
  it("claims a test count that the manifests can still produce", () => {
    // A number in a README is a claim like any other. This does not re-count the
    // suite — it fails if the claim is removed or mangled, so the figure cannot
    // rot into a decorative round number.
    const m = /([0-9]{3,}) tests, all packages/u.exec(README);
    expect(m, 'README should state "<n> tests, all packages"').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(400);
  });
});

/**
 * The README's test count must equal the measured one.
 *
 * Three separate places stated a suite size — the run-it-yourself block, the
 * per-suite table, and the proof deck — and all three were hand-typed and all
 * three were stale within a commit. `scripts/record-suite.sh` measures it into
 * site/api/suite.json; everything else has to agree with that file.
 */
describe("the README agrees with the measured suite", () => {
  const SUITE = join(ROOT, "site", "api", "suite.json");

  it("states the TypeScript count that was actually measured", () => {
    if (!existsSync(SUITE)) throw new Error("run scripts/record-suite.sh first");
    const s = JSON.parse(readFileSync(SUITE, "utf8")) as { typescript: number; total: number };
    const m = /# (\d+) tests, all packages/u.exec(README);
    expect(m, 'README should state "# <n> tests, all packages"').toBeTruthy();
    expect(Number(m![1]), "README disagrees with site/api/suite.json").toBe(s.typescript);
  });

  it("states the combined total that was actually measured", () => {
    const s = JSON.parse(readFileSync(SUITE, "utf8")) as { total: number };
    const m = /\((\d+) in total\)/u.exec(README);
    expect(m, 'README should state "(<n> in total)"').toBeTruthy();
    expect(Number(m![1])).toBe(s.total);
  });

  it("the per-suite table adds up to the measured total", () => {
    const s = JSON.parse(readFileSync(SUITE, "utf8")) as {
      total: number;
      packages: Array<{ package: string; passed: number }>;
    };
    for (const p of s.packages) {
      expect(README, `README's table is missing or wrong for ${p.package}`).toContain(
        `| ${p.package} | ${p.passed} |`,
      );
    }
    expect(README).toContain(`**${s.total} in total**`);
  });
});
