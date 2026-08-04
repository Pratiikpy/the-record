/**
 * Build the overdue report from the indexed scan, against real wall-clock time.
 * Reads only; no fork, no time travel — these deadlines have genuinely passed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildReport, type Obligation } from "./overdue.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "redemptions.json");
const OUT = join(HERE, "..", "out", "overdue.json");

const log = (m: string): void => void process.stderr.write(`${m}\n`);

const d = JSON.parse(readFileSync(IN, "utf8")) as { openRedemptions: Obligation[] };
const now = Math.floor(Date.now() / 1000);
const report = buildReport(d.openRedemptions, now);
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const t = report.totals;
const days = (s: number): string => (s / 86400).toFixed(1);

log(`\n─── unresolved obligations at ${report.generatedAt} ───`);
log(`  examined                 ${t.examined}`);
log(`  resolvable by executor   ${t.resolvableByExecutor}`);
log(`  resolvable by party      ${t.resolvableByParty}`);
log(`  window already closed    ${t.unresolvable}`);
log(`  not yet due              ${t.pending}`);
log(
  `  value unresolved         ${(Number(BigInt(t.valueUnresolvedUBA) / 1000n) / 1000).toLocaleString("en-US")} XRP`,
);
log(`  soonest window closes in ${t.soonestWindowClose === null ? "n/a" : `${days(t.soonestWindowClose)} days`}`);
log(`\n  ${report.caveat}`);
log(`→ ${OUT}`);
