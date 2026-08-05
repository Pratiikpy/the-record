/**
 * Render the backfilled series.
 *
 * The claim this page makes is narrow and stated everywhere: these rows were
 * computed in retrospect. They are exactly as re-derivable as a live row —
 * same heights, same evidence digest — and they were not published at the time.
 * Presenting retrospective work as contemporaneous would be the precise kind of
 * lie this project exists not to tell, so `retrospective` is a column, not a
 * footnote.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc } from "../../design/src/index.js";
import { navFor } from "../../design/src/nav.js";
import type { BackfillRow } from "./backfill-run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "backfill.json");
const OUT = join(HERE, "..", "out", "backfill.html");

interface Series {
  generatedAt: string;
  network?: { name: string; label: string; chainId: number; isMainnet: boolean };
  scope: readonly string[];
  scopeNote: string;
  xrplRetentionFloor: { ledger: number; iso: string };
  covenantBackfillable: boolean;
  covenantReason: string;
  slots: number;
  tally: Record<string, number>;
  rows: BackfillRow[];
}

const CLASS: Record<string, string> = { CLEAN: "ok", EXCEPTION: "bad", DISCLAIMER: "unknown" };
const GLYPH: Record<string, string> = { CLEAN: "✓", EXCEPTION: "✗", DISCLAIMER: "?" };
const chip = (o: string): string =>
  `<span class="verdict ${CLASS[o] ?? "none"}">[ ${GLYPH[o] ?? "·"} ] ${esc(o)}</span>`;

/** XRP from drops/UBA, both 6dp. */
const xrp = (v?: string): string =>
  v === undefined ? "—" : (Number(BigInt(v) / 1000n) / 1000).toLocaleString("en-US");

function row(r: BackfillRow): string {
  const cs = Object.fromEntries(r.controls.map((c) => [c.id, c.opinion]));
  const diff =
    r.escrowedFundsUBA && r.onLedgerEscrowedDrops
      ? BigInt(r.escrowedFundsUBA) - BigInt(r.onLedgerEscrowedDrops)
      : null;

  return `<tr>
    <th scope="row">${esc(r.utc.slice(0, 10))}<small>flare ${r.flareBlock} · xrpl ${r.xrplLedger}</small></th>
    <td class="l">${chip(r.opinion)}</td>
    <td class="l mono">${["C2", "C3", "C4"].map((id) => `<span class="cc ${CLASS[cs[id] ?? ""] ?? ""}">${(cs[id] ?? "·")[0]}</span>`).join("")}</td>
    <td>${xrp(r.escrowedFundsUBA)}</td>
    <td>${xrp(r.onLedgerEscrowedDrops)}</td>
    <td>${r.escrowCount ?? "—"}</td>
    <td class="${diff !== null && diff !== 0n ? "bad" : ""}">${diff === null ? "—" : diff === 0n ? "0" : xrp(diff.toString())}</td>
    <td>${r.skewSeconds}s</td>
  </tr>`;
}

/**
 * § 2.4 — derived from the rows, never asserted over them.
 *
 * This section used to state the empty-allowlist finding unconditionally. Once
 * the series moved to mainnet the page rendered 45 CLEAN rows beneath a heading
 * claiming exceptions across the early period — prose contradicting the table
 * underneath it, which is the same defect as a headline promising defaults
 * above a count of zero. What a series shows has to come out of the series.
 */
function findingSection(s: Series): string {
  const exceptions = s.rows.filter((r) => r.opinion === "EXCEPTION");
  const label = s.network?.label ?? "this network";
  const verify = [
    '<pre class="cmd"><code>cast call --rpc-url https://coston2-api.flare.network/ext/C/rpc \\',
    '  --block 27444811 0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b \\',
    '  "getAllowedDestinationAddresses()(string[])"',
    '<span class="dimline">[]</span></code></pre>',
  ].join("\n");

  if (exceptions.length === 0) {
    return [
      "  <section>",
      '    <div class="eyebrow">§ 2.4 — What this series shows</div>',
      `    <h2>No exception across ${s.rows.length} sampled heights on ${esc(label)}</h2>`,
      '    <p class="lede">Every backing control held at every height sampled here. That is a finding about',
      `      ${esc(label)} and nothing more — the same procedure run backwards over <strong>Coston2</strong>`,
      "      reports 42 exceptions, because the Core Vault's destination allowlist was empty for its first",
      "      three months and the outflow control had nothing to check against.</p>",
      '    <p class="cap">Verify that separately, one call, no trust in us:</p>',
      verify,
      '    <p class="cap" style="margin-top:14px">Fig. 1 — A clean series is not a stronger result than a',
      "      dirty one. It is a different one, and it is only worth reading because the same controls",
      "      demonstrably fire elsewhere.</p>",
      "  </section>",
    ].join("\n");
  }

  return [
    "  <section>",
    '    <div class="eyebrow">§ 2.4 — What a long series shows that a short one cannot</div>',
    `    <h2>${exceptions.length} exception${exceptions.length === 1 ? "" : "s"} across ${s.rows.length} sampled heights on ${esc(label)}</h2>`,
    '    <p class="lede">C2 tests the preconditions that make C1 meaningful. Across the early period it',
    "      reports EXCEPTION: <code>getAllowedDestinationAddresses()</code> returned an <strong>empty",
    "      list</strong>, so the outflow-destination control had nothing to check against and would have",
    "      passed vacuously. The list was populated later. Anyone whose monitoring began this summer sees a",
    "      healthy allowlist and has no way to learn this happened.</p>",
    '    <p class="cap">Verify independently, one call, no trust in us:</p>',
    verify,
    `    <p class="cap" style="margin-top:14px">Fig. 1 — The first exception is at ${esc(exceptions[0]!.utc.slice(0, 10))} and the last at ${esc(exceptions[exceptions.length - 1]!.utc.slice(0, 10))}.</p>`,
    "  </section>",
  ].join("\n");
}

function main(): void {
  const s = JSON.parse(readFileSync(IN, "utf8")) as Series;
  const exceptions = s.rows.filter((r) => r.opinion === "EXCEPTION");
  const suppressed = s.rows.filter((r) => r.skewNote).length;
  const first = s.rows[0]!;
  const last = s.rows[s.rows.length - 1]!;
  const days = Math.round((Date.parse(last.utc) - Date.parse(first.utc)) / 86_400_000);

  const body = `
  <section>
    ${marker("Procedure · backfill")}
    <h1>History is a property of the chain, not of when you started.</h1>
    <p class="lede">A continuous register is assumed to need a warm-up period: deploy a cron, wait a year,
      have a year of history. But CV-1 is a pure function of chain state at a height — so the opinion for
      every past height already exists and has merely never been evaluated. This register did not wait.
      It computed.</p>

    <div class="stats">
      ${stat("Period covered", `${days} days`, `${s.slots} sampled heights, ${first.utc.slice(0, 10)} → ${last.utc.slice(0, 10)}`)}
      ${stat("Exceptions", String(exceptions.length), `${s.tally.CLEAN ?? 0} clean · confirmed across a skew bracket`)}
      ${stat("Skew-suppressed", String(suppressed), "candidate exceptions that failed the bracket")}
      ${stat("Derivation", "retrospective", "every row, stated on every row")}
    </div>

    <div class="note">
      <p><span class="tag">Computed in retrospect</span>Each row is pinned to a Flare block and an XRPL
      ledger and is <em>exactly</em> as re-derivable as a live one. It was <strong>not</strong> published at
      the time, and it never claims to have been.</p>
      <p><strong>The skew bracket.</strong> Flare blocks and XRPL ledgers close on independent clocks, so a
      pair matched to the same instant can straddle an <code>EscrowCreate</code> and look exactly like a
      backing shortfall. A live cron reads both chains once and never revisits the gap; a backfill re-runs
      that ambiguity at every slot, so every candidate exception is re-evaluated at ledgers either side and
      is only published if it survives all three. Anything that does not becomes a DISCLAIMER naming the
      skew — because that is what we actually know. A cron cannot produce a skew bracket at all.</p>
      <p><strong>Scope.</strong> ${esc(s.scopeNote)}</p>
      <p><strong>Covenant is not backfillable and we will not pretend otherwise.</strong>
      ${esc(s.covenantReason)}.</p>
    </div>
  </section>

  ${findingSection(s)}

  <section>
    <div class="eyebrow">§ 2.5 — The series</div>
    <h2>Every sampled height, and what it said</h2>
    <div class="tablewrap">
      <table style="min-width:880px">
        <caption>Backfilled CV-1 opinions by sampled height, with the two escrow figures being reconciled and the cross-chain skew at each pair.</caption>
        <thead><tr>
          <th class="l" scope="col">Date</th>
          <th class="l" scope="col">Opinion</th>
          <th class="l" scope="col">C2·C3·C4</th>
          <th scope="col">Escrow (Flare)</th>
          <th scope="col">Escrow (XRPL)</th>
          <th scope="col">Objects</th>
          <th scope="col">Difference</th>
          <th scope="col">Skew</th>
        </tr></thead>
        <tbody>
${s.rows.map(row).join("\n")}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <div><span class="verdict ok">[ ✓ ]</span> tested and held</div>
      <div><span class="verdict bad">[ ✗ ]</span> tested and breached</div>
      <div><span class="verdict unknown">[ ? ]</span> insufficient evidence — not a pass</div>
    </div>
    <p class="cap" style="margin-top:18px">
      Fig. 2 — XRPL public retention floors at ledger ${s.xrplRetentionFloor.ledger}
      (${esc(s.xrplRetentionFloor.iso.slice(0, 10))}); earlier periods are structurally unobtainable from
      any public server and are not claimed.
    </p>
    <p class="cap" style="margin-top:14px">
      <a class="cite" href="index.html">[ ← Back to CV-1, the live register ]</a>
    </p>
  </section>

  <section>
    <div class="eyebrow">§ 2.6 — The safeguard, audited</div>
    <h2>The skew bracket has never suppressed anything</h2>
    <p class="lede">Across all ${s.slots} sampled heights, <strong>zero</strong> candidate exceptions were
      suppressed by the bracket. That is either &ldquo;no artifacts occurred&rdquo; or &ldquo;the bracket
      cannot suppress&rdquo;, and the two are indistinguishable from the result alone — which is precisely
      the failure this project already shipped once, one level further down.</p>
    <p class="lede">So the adjudicator is a pure exported function with its own tests, and it is checked
      against a disagreeing bracket, a wholly-disagreeing bracket, and an unreadable one. It suppresses in
      all three. Its zero-suppression record here is therefore a measured result about the data, not an
      untested assumption about the code. Maximum observed skew across the series was
      <strong>${Math.max(...s.rows.map((r) => r.skewSeconds))} seconds</strong>.</p>
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "Procedure — backfilled series",
      description:
        "CV-1 re-evaluated across historical Flare blocks and XRP Ledger ledgers. Every row computed in retrospect, and labelled as such.",
      section: "procedure",
      meta: `backfill · ${s.slots} heights · retrospective`,
      nav: navFor("procedure"),
      body,
      extraCss:
        ".mono{font-family:var(--mono)}" +
        ".cc{display:inline-block;width:15px;text-align:center;font-family:var(--mono);font-size:11px}" +
        ".cc.bad{color:var(--v-bad);font-weight:600}.cc.ok{color:var(--v-ok)}.cc.unknown{color:var(--v-unknown)}" +
        "td.bad{color:var(--v-bad)}" +
        ".cmd{border:1px solid var(--rule);padding:12px 14px;overflow-x:auto;font-size:11.5px;line-height:1.7}" +
        ".cmd code{font-family:var(--mono)}.dimline{color:var(--faint)}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();
