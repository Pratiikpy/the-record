/**
 * The clinic — every registered TEE machine, and what is actually wrong with it.
 *
 * `doctor` was the most immediately useful thing in this repo and it had no
 * public surface at all: you had to clone the project and run a CLI to learn
 * that most of the fleet is unreachable. An instrument nobody can reach is not
 * a product, so this renders the same diagnosis as a page.
 *
 * It reads `packages/reprod/out/scan.json` — the same file the Reprod register
 * publishes from — so the two cannot quietly disagree. No network, no keys.
 *
 * Nothing here names an operator as being at fault. Every finding states an
 * observed fact and the fix for it, because the point is a fleet that works,
 * not a leaderboard of who is worst. Addresses appear because they are already
 * public on chain and are the only way an operator can find their own machine.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc } from "../../design/src/index.js";
import { navFor } from "../../design/src/nav.js";
import { diagnose, verdictOf, type MachineFacts, type Finding, type Severity } from "./diagnose.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN = join(HERE, "..", "..", "reprod", "out", "scan.json");
const OUTDIR = join(HERE, "..", "out");
const OUT = join(OUTDIR, "index.html");

const SEV_CLASS: Record<Severity | "OK", string> = {
  BLOCKER: "bad",
  WARNING: "sim",
  NOTE: "unknown",
  OK: "ok",
};
const SEV_GLYPH: Record<Severity | "OK", string> = {
  BLOCKER: "✗",
  WARNING: "!",
  NOTE: "·",
  OK: "✓",
};

const chip = (s: Severity | "OK"): string =>
  `<span class="verdict ${SEV_CLASS[s]}">[ ${SEV_GLYPH[s]} ] ${esc(s)}</span>`;

interface Diagnosed {
  machine: MachineFacts;
  findings: Finding[];
  verdict: Severity | "OK";
}

/**
 * How many machines each distinct finding affects — the fleet's actual problems.
 *
 * HEALTHY is excluded. It is a real finding and it belongs on a machine's own
 * diagnosis, but a table headed "the fleet's problems" that lists "No faults
 * found" as one of them is a category error, and this page shipped with it.
 */
const NOT_A_PROBLEM = new Set(["HEALTHY"]);

function byFinding(rows: readonly Diagnosed[]): Array<{ f: Finding; count: number }> {
  const seen = new Map<string, { f: Finding; count: number }>();
  for (const r of rows) {
    for (const f of r.findings) {
      if (NOT_A_PROBLEM.has(f.id)) continue;
      const hit = seen.get(f.id);
      if (hit) hit.count += 1;
      else seen.set(f.id, { f, count: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

const RANK: Record<Severity, number> = { BLOCKER: 0, WARNING: 1, NOTE: 2 };

function findingRow(x: { f: Finding; count: number }, total: number): string {
  const pct = ((x.count / total) * 100).toFixed(0);
  return `<tr>
    <td class="l">${chip(x.f.severity)}</td>
    <th scope="row" class="l">${esc(x.f.title)}<small>${esc(x.f.observed.replace(/\s+/gu, " ").slice(0, 110))}</small></th>
    <td>${x.count}<small>${pct}%</small></td>
    <td class="l fix">${x.f.fix ? esc(x.f.fix) : "<em>no fix known — stated rather than invented</em>"}</td>
  </tr>`;
}

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });
  const scan = JSON.parse(readFileSync(SCAN, "utf8")) as {
    scannedAt?: string;
    machines: MachineFacts[];
  };

  const rows: Diagnosed[] = scan.machines.map((m) => {
    const findings = diagnose(m);
    return { machine: m, findings, verdict: verdictOf(findings) };
  });

  const total = rows.length;
  const blocked = rows.filter((r) => r.verdict === "BLOCKER").length;
  const healthy = rows.filter((r) => r.verdict === "OK").length;
  const dead = rows.filter((r) => r.machine.liveness === "DEAD").length;
  const problems = byFinding(rows).sort(
    (a, b) => RANK[a.f.severity] - RANK[b.f.severity] || b.count - a.count,
  );

  const worst = rows
    .filter((r) => r.verdict === "BLOCKER")
    .sort((a, b) => b.findings.length - a.findings.length)
    .slice(0, 8);

  const body = `
  <section>
    ${marker("The clinic")}
    <h1>Most of the fleet is unreachable, and every operator can be told why.</h1>
    <p class="lede">Reprod measures what a code hash establishes. This asks a plainer question about the
      same machines: <em>is this one actually working, and if not, what is the fix?</em> Every finding
      below is derived from the published scan — no keys, no network, nothing you could not check.</p>

    <div class="stats">
      ${stat("Machines examined", String(total), "every machine in FlareTeeManager")}
      ${stat("At least one blocker", String(blocked), `${((blocked / total) * 100).toFixed(0)}% of the fleet`)}
      ${stat("Did not answer", String(dead), "registered on chain, unreachable in practice")}
      ${stat("Clean", String(healthy), "no blocker, no warning, no note")}
    </div>

    <div class="note">
      <p><span class="tag">This is a fix list, not a leaderboard</span>Nothing here says an operator did
      something wrong. Most of these machines are development instances doing exactly what development
      instances do, and simulated attestation is explicitly permitted. Addresses appear because they are
      already public on chain and are the only way someone can find their own machine.</p>
      <p>Every finding states the observed fact and the fix. Where we do not know the fix, it says so
      rather than inventing one.</p>
    </div>
  </section>

  <section>
    <div class="eyebrow">§ 5.1 — What is actually wrong</div>
    <h2>The fleet's problems, by how many machines they affect</h2>
    <div class="tablewrap">
      <table style="min-width:820px">
        <caption>Each distinct finding the diagnosis produces, how many machines carry it, and what to do.</caption>
        <thead><tr>
          <th class="l" scope="col">Severity</th>
          <th class="l" scope="col">Finding</th>
          <th scope="col">Machines</th>
          <th class="l" scope="col">Fix</th>
        </tr></thead>
        <tbody>
${problems.map((p) => findingRow(p, total)).join("\n")}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <div><span class="verdict bad">[ ✗ ]</span> blocker — the machine cannot do its job</div>
      <div><span class="verdict sim">[ ! ]</span> warning — it works, but not dependably</div>
      <div><span class="verdict unknown">[ · ]</span> note — true and worth knowing, not a fault</div>
    </div>
  </section>

  <section>
    <div class="eyebrow">§ 5.2 — The worst configured</div>
    <h2>Where an operator should start</h2>
    <div class="tablewrap">
      <table style="min-width:760px">
        <caption>The machines carrying the most blockers, with the first thing to fix on each.</caption>
        <thead><tr>
          <th class="l" scope="col">Machine</th>
          <th class="l" scope="col">Verdict</th>
          <th scope="col">Findings</th>
          <th class="l" scope="col">First fix</th>
        </tr></thead>
        <tbody>
${worst
  .map((r) => {
    const first = r.findings.find((f) => f.severity === "BLOCKER") ?? r.findings[0];
    return `          <tr>
            <th scope="row"><code>${esc(r.machine.teeId)}</code><small>extension ${esc(r.machine.extensionId)} · ${esc(r.machine.platform)}</small></th>
            <td class="l">${chip(r.verdict)}</td>
            <td>${r.findings.length}</td>
            <td class="l fix">${first?.fix ? esc(first.fix) : "—"}</td>
          </tr>`;
  })
  .join("\n")}
        </tbody>
      </table>
    </div>
    <p class="cap" style="margin-top:18px">
      Fig. 1 — Ranked by blocker count. Run it against any machine yourself:
      <code>pnpm --filter @therecord/doctor doctor &lt;teeId|extensionId|host&gt;</code>
    </p>
    <p class="cap" style="margin-top:14px">
      <a class="cite" href="../reprod/index.html">[ ← What a code hash establishes ]</a>
    </p>
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "The clinic — every TEE machine, diagnosed",
      description:
        "Every machine in Flare's TEE registry, what is wrong with it, and the fix. Derived from the published scan; no keys, no network.",
      section: "reprod",
      meta: `doctor · ${total} machines · ${blocked} with a blocker`,
      nav: navFor("reprod"),
      body,
      extraCss:
        "td.fix{max-width:340px;font-size:12.5px;color:var(--muted)}" +
        "td small,th small{display:block;margin-top:3px;font-size:10.5px;color:var(--faint);font-weight:400}" +
        "td.fix em{color:var(--faint)}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();
