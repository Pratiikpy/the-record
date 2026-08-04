/**
 * Build the site index.
 *
 * Three registers that only link sideways read as three separate demos. The
 * index states the one thesis they share and carries each register's current
 * headline figure, read from its own output rather than retyped — a landing
 * page whose numbers drift from the pages it links to is worse than none.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, esc } from "./index.js";
import { hrefFromIndex, labelOf, REGISTERS } from "./nav.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUTDIR = join(ROOT, "site");
const OUT = join(OUTDIR, "index.html");

const read = <T,>(p: string): T | null =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;

interface Card {
  name: string;
  proves: string;
  href: string;
  contract: string;
  figures: Array<[string, string]>;
  note: string;
}

function buildCards(): Card[] {
  const scan = read<{
    totalActiveMachines: number;
    machines: Array<{ liveness: string; attestation: string }>;
  }>(join(ROOT, "packages/reprod/out/scan.json"));
  const rebuilds = read<{ summary: Record<string, number> }>(
    join(ROOT, "packages/reprod/out/rebuilds.json"),
  );
  const red = read<{ totals: { redemptionsRequested: number; withNamedExecutorPct: number } }>(
    join(ROOT, "packages/covenant/out/redemptions.json"),
  );
  const overdue = read<{
    totals: { examined: number; pending: number; resolvableByExecutor: number; soonestWindowClose: number | null };
  }>(join(ROOT, "packages/covenant/out/overdue.json"));
  const cv1 = read<{ opinion: string; controls: unknown[]; evidence: { outflows: number } }>(
    join(ROOT, "packages/procedure/out/cv1.json"),
  );

  const dead = scan?.machines.filter((m) => m.liveness === "DEAD").length ?? 0;
  const sim = scan?.machines.filter((m) => m.attestation === "SIMULATED").length ?? 0;
  const total = scan?.totalActiveMachines ?? 0;
  const pastDue = overdue ? overdue.totals.examined - overdue.totals.pending : 0;

  return [
    {
      name: "Covenant",
      proves: "the promises were kept — or provably were not",
      href: hrefFromIndex("covenant"),
      contract: "FailRecord.sol",
      figures: [
        ["Redemptions indexed", red ? red.totals.redemptionsRequested.toLocaleString("en-US") : "—"],
        ["Named an executor", red ? `${red.totals.withNamedExecutorPct}%` : "—"],
        ["Past deadline, unresolved", String(pastDue)],
        [
          "Soonest proof window",
          overdue?.totals.soonestWindowClose != null
            ? `${(overdue.totals.soonestWindowClose / 86400).toFixed(1)}d`
            : "—",
        ],
      ],
      note: "A default does not record itself — redemptionPaymentDefault has to be called. Zero recorded defaults is the gap, not evidence against one.",
    },
    {
      name: "Procedure",
      proves: "the books are the books",
      href: hrefFromIndex("procedure"),
      contract: "AssuranceRegistry.sol",
      figures: [
        ["Opinion", cv1?.opinion ?? "—"],
        ["Controls tested", cv1 ? String(cv1.controls.length) : "—"],
        ["Outflows examined", cv1 ? String(cv1.evidence.outflows) : "—"],
        ["Client cooperation needed", "none"],
      ],
      note: "CLEAN, EXCEPTION or DISCLAIMER. A procedure that can only produce good news is marketing, so refusing to conclude is a first-class result.",
    },
    {
      name: "Reprod",
      proves: "the code is the code",
      href: hrefFromIndex("reprod"),
      contract: "ReproRegistry.sol",
      figures: [
        ["Machines registered", String(total)],
        ["Unreachable now", total ? `${((dead / total) * 100).toFixed(0)}%` : "—"],
        ["Simulated", total ? `${((sim / total) * 100).toFixed(0)}%` : "—"],
        [
          "Images rebuilt here",
          rebuilds ? String(Object.values(rebuilds.summary).reduce((a, b) => a + b, 0)) : "—",
        ],
      ],
      note: "Flare's documented recipe cannot rebuild Flare's own extension images. Resolved here — and only two of five are independently verifiable by anyone else.",
    },
  ];
}

function card(c: Card): string {
  return `<article class="reg">
    <div class="reg-head">
      <h2><a class="reg-link" href="${esc(c.href)}">${esc(c.name)}</a></h2>
      <span class="cap">${esc(c.contract)}</span>
    </div>
    <p class="proves">${esc(c.proves)}</p>
    <dl class="figs">
${c.figures.map(([k, v]) => `      <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("\n")}
    </dl>
    <p class="reg-note">${esc(c.note)}</p>
    <a class="act" href="${esc(c.href)}">[ Open the register ]</a>
  </article>`;
}

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });
  const cards = buildCards();

  const body = `
  <section>
    ${marker("The Record")}
    <h1>Facts that cannot be self-asserted.</h1>
    <p class="lede">Three registers on Flare, each answering a question the interested party is not
      allowed to answer about itself: <em>did you pay</em>, <em>are the books real</em>, <em>is this the
      code you published</em>. Every figure below is re-derivable from public RPC by anyone, and the
      protocol is never the counterparty — it holds no float, seeds no liquidity and underwrites nothing.</p>

    <div class="regs">
${cards.map(card).join("\n")}
    </div>

    <div class="note">
      <p><span class="tag">What these will not do</span>Say more than the evidence supports. Unresolved is
      not unpaid. Determinism is not verification. Unknown is not clean. Each register refuses to conclude
      where it cannot, and records that refusal rather than rounding it up to a pass.</p>
    </div>

    <p class="cap" style="margin-top:26px">
      Fig. 1 — Figures read from each register's own output at build time, never retyped.
    </p>
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "The Record — facts that cannot be self-asserted",
      description:
        "Three registers on Flare: Covenant proves the promises, Procedure proves the books, Reprod proves the code. Every figure re-derivable from public RPC.",
      section: "index",
      meta: `built ${new Date().toISOString().slice(0, 16)}Z`,
      nav: REGISTERS.map((r) => ({ label: labelOf(r), href: hrefFromIndex(r) })),
      body,
      extraCss: `
.regs{margin-top:44px;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--rule-strong);border:1px solid var(--rule-strong)}
@media(max-width:900px){.regs{grid-template-columns:1fr}}
.reg{background:var(--paper);padding:26px 24px;display:flex;flex-direction:column}
.reg-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.reg h2{margin:0;font-size:26px}
.reg-link{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--rule-dashed)}
.reg-link:hover{border-bottom-color:var(--ink)}
.proves{margin:10px 0 0;font-size:14px;color:var(--muted)}
.figs{margin:22px 0 0;display:grid;gap:10px}
.figs div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:1px dashed var(--rule-dashed);padding-bottom:8px}
.figs dt{font-family:var(--mono);font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.08em}
.figs dd{margin:0;font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums}
.reg-note{margin:18px 0 22px;font-size:13px;line-height:1.6;color:var(--muted);flex:1}
.act{display:inline-block;align-self:flex-start;font-family:var(--mono);font-size:12px;border:1px solid rgb(from var(--ink) r g b / .4);padding:9px 16px;color:var(--ink);text-decoration:none;transition:border-color .2s,background .2s}
.act:hover{border-color:var(--ink);background:var(--wash)}`,
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();

