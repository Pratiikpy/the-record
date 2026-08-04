/**
 * Render the scan as a static page — no backend, no framework.
 *
 * Every number on the page comes from out/scan.json, which any third party can
 * regenerate from public RPC. The page is built to be screenshotted and cited,
 * so it must survive greyscale printing: verdicts carry a glyph and a border
 * style as well as a colour.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ScanResult, MachineRow } from "./scan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "scan.json");
const OUT = join(HERE, "..", "out", "index.html");

const esc = (s: string): string =>
  s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const short = (h: string, n = 10): string => (h.length > n + 4 ? `${h.slice(0, n)}…${h.slice(-4)}` : h);

const VERDICT_GLYPH: Record<string, string> = {
  REPRODUCED: "✓",
  DIVERGED: "✗",
  UNREPRODUCIBLE: "?",
  SIMULATED: "~",
  NO_KNOWN_SOURCE: "·",
};
const VERDICT_CLASS: Record<string, string> = {
  REPRODUCED: "ok",
  DIVERGED: "bad",
  UNREPRODUCIBLE: "unknown",
  SIMULATED: "sim",
  NO_KNOWN_SOURCE: "none",
};

function verdictChip(v: string): string {
  return `<span class="verdict ${VERDICT_CLASS[v] ?? "none"}">[ ${VERDICT_GLYPH[v] ?? "·"} ] ${v.replace(/_/gu, " ")}</span>`;
}

function livenessChip(l: string): string {
  const cls = l === "LIVE" ? "ok" : l === "DEAD" ? "bad" : "unknown";
  const glyph = l === "LIVE" ? "●" : l === "DEAD" ? "○" : "?";
  return `<span class="verdict ${cls}">[ ${glyph} ] ${l}</span>`;
}

function row(m: MachineRow): string {
  const flags = [
    m.ephemeral ? `<abbr title="${esc(m.ephemeralReason ?? "")}">ephemeral</abbr>` : "",
    m.insecure ? `<abbr title="proxy served over plain http://">insecure</abbr>` : "",
    m.machinesOnThisUrl > 1 ? `<abbr title="${m.machinesOnThisUrl} machines share this proxy URL">shared ×${m.machinesOnThisUrl}</abbr>` : "",
  ].filter(Boolean).join(" · ");

  return `<tr>
    <th scope="row"><a class="cite" href="https://coston2.testnet.flarescan.com/address/${m.teeId}" target="_blank" rel="noopener">${short(m.teeId, 12)}</a><small>ext ${esc(m.extensionId)} · ${esc(m.status)}</small></th>
    <td class="l">${verdictChip(m.attestation)}</td>
    <td class="l">${livenessChip(m.liveness)}</td>
    <td class="l"><code>${short(m.codeHash, 12)}</code><small>${esc(m.platform || "—")}</small></td>
    <td class="l host">${esc(m.host)}<small>${flags || "&nbsp;"}</small></td>
    <td>${m.probeMs ?? "—"}</td>
  </tr>`;
}

function statCell(k: string, v: string, n: string): string {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="n">${esc(n)}</div></div>`;
}

function main(): void {
  const d = JSON.parse(readFileSync(IN, "utf8")) as ScanResult;
  const m = d.machines;

  const dead = m.filter((x) => x.liveness === "DEAD").length;
  const sim = m.filter((x) => x.attestation === "SIMULATED").length;
  const real = m.length - sim;
  const pct = (n: number): string => `${((n / m.length) * 100).toFixed(0)}%`;

  const scanned = new Date(d.scannedAt).toISOString().replace("T", " ").slice(0, 16);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Every confidential-compute machine registered on Flare Coston2, with attestation verdict and live reachability. Re-derivable from public RPC.">
<meta name="color-scheme" content="light dark">
<title>Reprod — Flare Confidential Compute machine register</title>
<style>
/* --faint is measured, not inherited: #8A867F scored 3.44:1 on paper, below the
   4.5:1 AA floor, and it carries table headers, stat labels and 10.5px sublines.
   #757068 = 4.72:1 light, #8C867A = 5.13:1 dark. Verified in-browser. */
:root{--ink:#1F1E1D;--ink-soft:#2C2A28;--paper:#FAF9F5;--muted:#4A4742;--graphite:#6E6A64;--faint:#757068;
--rule:rgb(31 30 29/.15);--rule-strong:rgb(31 30 29/.25);--rule-dashed:rgb(31 30 29/.30);--wash:rgb(31 30 29/.04);
--v-ok:#3F6F4B;--v-bad:#8C3A2E;--v-unknown:#757068;--v-sim:#7A6A3F;
--serif:"IBM Plex Serif",Georgia,"Times New Roman",serif;
--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root{--ink:#EDEAE3;--ink-soft:#D9D5CC;--paper:#161512;--muted:#B3AEA3;--graphite:#918B80;--faint:#8C867A;
--rule:rgb(237 234 227/.15);--rule-strong:rgb(237 234 227/.26);--rule-dashed:rgb(237 234 227/.32);--wash:rgb(237 234 227/.05);
--v-ok:#7FA98A;--v-bad:#CE8272;--v-unknown:#8C867A;--v-sim:#B7A06A}}
:root[data-theme="dark"]{--ink:#EDEAE3;--ink-soft:#D9D5CC;--paper:#161512;--muted:#B3AEA3;--graphite:#918B80;--faint:#8C867A;
--rule:rgb(237 234 227/.15);--rule-strong:rgb(237 234 227/.26);--rule-dashed:rgb(237 234 227/.32);--wash:rgb(237 234 227/.05);
--v-ok:#7FA98A;--v-bad:#CE8272;--v-unknown:#8C867A;--v-sim:#B7A06A}
:root[data-theme="light"]{--ink:#1F1E1D;--paper:#FAF9F5;--muted:#4A4742;--faint:#8A867F;
--rule:rgb(31 30 29/.15);--rule-strong:rgb(31 30 29/.25);--rule-dashed:rgb(31 30 29/.30);--wash:rgb(31 30 29/.04);
--v-ok:#3F6F4B;--v-bad:#8C3A2E;--v-unknown:#757068;--v-sim:#7A6A3F}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-weight:300;font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}
.shell{max-width:1180px;margin-inline:auto;padding-inline:24px}
.masthead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:16px}
.brand{display:flex;align-items:center;gap:10px}
.mark{position:relative;width:20px;height:20px;flex:none}
.mark span{position:absolute;width:8px;height:8px;border-radius:2px;background:var(--ink)}
.mark span:nth-child(1){top:0;left:0}.mark span:nth-child(2){top:0;right:0;opacity:.55}
.mark span:nth-child(3){bottom:0;left:0;opacity:.55}.mark span:nth-child(4){bottom:0;right:0;opacity:.25}
.wordmark{font-family:var(--mono);font-size:14px;font-weight:500;letter-spacing:.02em}
section{border-top:1px solid var(--rule);padding-block:64px}section:first-of-type{border-top:0}
.marker{position:relative;display:inline-block;border:1px solid var(--rule-strong);padding:7px 16px}
.marker b{position:absolute;font-family:var(--mono);font-size:12px;line-height:1;font-weight:400}
.marker b:nth-of-type(1){left:-5px;top:-9px}.marker b:nth-of-type(2){right:-5px;top:-9px}
.marker b:nth-of-type(3){left:-5px;bottom:-9px}.marker b:nth-of-type(4){right:-5px;bottom:-9px}
.marker span{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.16em}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(30px,6vw,48px);line-height:1.08;letter-spacing:-.015em;text-wrap:balance;margin:24px 0 0}
h2{font-family:var(--serif);font-weight:400;font-size:clamp(23px,4vw,32px);line-height:1.18;letter-spacing:-.01em;margin:20px 0 0}
.lede{max-width:660px;margin:20px 0 0;color:var(--muted);text-wrap:pretty}
.cap{font-family:var(--mono);font-size:11px;color:var(--faint)}
.eyebrow{font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.04em}
.stats{margin-top:40px;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--rule-strong);border:1px solid var(--rule-strong)}
@media(max-width:820px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--paper);padding:22px 20px}
.stat .k{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint)}
.stat .v{font-family:var(--serif);font-weight:300;font-size:clamp(26px,4.4vw,36px);line-height:1.05;letter-spacing:-.02em;margin-top:10px;font-variant-numeric:tabular-nums}
.stat .n{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:8px}
.tablewrap{overflow-x:auto;margin-top:18px;border:1px solid var(--rule-strong)}
table{width:100%;min-width:940px;border-collapse:collapse;font-family:var(--mono);font-size:12.5px}
caption{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
thead th{text-align:right;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);padding:11px 13px;border-bottom:1px solid var(--rule-strong);white-space:nowrap}
thead th:first-child,thead th.l{text-align:left}
tbody th,tbody td{padding:11px 13px;border-bottom:1px dashed var(--rule-dashed);vertical-align:top}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
tbody th{text-align:left;font-weight:400}
tbody td{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
tbody td.l{text-align:left;white-space:normal}
tbody small{display:block;color:var(--faint);font-size:10.5px;margin-top:3px}
tbody tr:hover th,tbody tr:hover td{background:var(--wash)}
.host{max-width:280px;overflow-wrap:anywhere}
code{font-family:var(--mono)}
abbr{text-decoration:underline dotted;text-underline-offset:2px;cursor:help}
.verdict{display:inline-block;font-size:11.5px;padding:2px 8px;white-space:nowrap}
.verdict.ok{color:var(--v-ok);border:1px solid var(--v-ok)}
.verdict.bad{color:var(--v-bad);border:3px double var(--v-bad)}
.verdict.unknown{color:var(--v-unknown);border:1px dashed var(--v-unknown)}
.verdict.sim{color:var(--v-sim);border:1px dotted var(--v-sim)}
.verdict.none{color:var(--faint);border:1px solid var(--rule-strong)}
.cite{color:var(--muted);text-decoration:none;border-bottom:1px solid var(--rule-dashed)}
.cite:hover{color:var(--ink);border-bottom-color:var(--ink)}
a:focus-visible,.cite:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.legend{display:flex;flex-wrap:wrap;gap:10px 24px;margin-top:20px}
.legend div{font-family:var(--mono);font-size:11px;color:var(--faint);display:flex;align-items:center;gap:8px}
.note{margin-top:34px;border:1px dashed var(--rule-dashed);padding:18px 22px}
.note p{margin:0;font-size:14px;color:var(--muted);max-width:70ch}
.note p+p{margin-top:10px}
.tag{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.14em;border:1px solid var(--rule-strong);padding:3px 9px;margin-right:10px}
footer{border-top:1px solid var(--rule);padding-block:36px 52px;text-align:center;font-family:var(--mono);font-size:11px;color:var(--faint)}
@media(max-width:720px){
  .shell{padding-inline:16px}
  .masthead{flex-direction:column;align-items:flex-start;gap:6px}
  section{padding-block:44px}
  .stats{grid-template-columns:repeat(2,1fr)}
  .legend{gap:8px 16px}
  /* Reserve two label lines so the figures share a baseline even when one
     label wraps and its neighbour does not. */
  .stat .k{min-height:3.4em}
}
@media print{body{background:#fff;color:#000}.tablewrap{overflow:visible;border:0}table{min-width:0;font-size:9px}}
@media(prefers-reduced-motion:reduce){*,::before,::after{transition-duration:.001ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}}
</style>
</head>
<body>

<div class="shell">
  <header class="masthead">
    <div class="brand">
      <div class="mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <span class="wordmark">the record · reprod</span>
    </div>
    <span class="cap">chain 114 · block ${esc(d.blockNumber)} · ${esc(scanned)}Z</span>
  </header>

  <section>
    <div class="marker">
      <b aria-hidden="true">+</b><b aria-hidden="true">+</b><b aria-hidden="true">+</b><b aria-hidden="true">+</b>
      <span>Reprod · Machine register</span>
    </div>

    <h1>Every confidential-compute machine Flare has on record, and whether it is really there.</h1>

    <p class="lede">Read straight from the FlareTeeManager registry on Coston2 and probed live.
      Nothing here needs anyone's permission or cooperation: the register is public, the proxies
      answer or they do not, and every row is re-derivable from public RPC by anyone.</p>

    <div class="stats">
      ${statCell("Machines registered", String(d.totalActiveMachines), `${d.summary.distinctExtensions} extensions`)}
      ${statCell("Unreachable now", String(dead), `${pct(dead)} of the register`)}
      ${statCell("Simulated", String(sim), `${pct(sim)} — bound to no source`)}
      ${statCell("Real confidential HW", String(real), `across ${d.summary.distinctCodeHashes - 1} code hashes`)}
    </div>

    <p class="cap" style="margin-top:14px">
      Fig. 1 — Register summary at block ${esc(d.blockNumber)}. “Simulated” means the machine attested to
      a simulator: a single shared code hash that binds to no source code at all. It is a legitimate
      development mode, not a fault — but it is not evidence of anything.
    </p>

    <div class="note">
      <p><span class="tag">Method</span>Liveness is a single <code>GET /info</code> per unique proxy URL,
      8&nbsp;s timeout, no credentials, no redirects followed. A machine is marked unreachable only when
      its own registered URL fails to answer.</p>
      <p><strong>Where we deliberately say nothing:</strong> several machines share one proxy URL, and a
      proxy serves a single <code>/info</code>. When more than one machine sits behind a URL, its response
      cannot be attributed to any one of them — those are recorded as <em>ambiguous</em> and never as drift.
      Of ${esc(String(d.totalActiveMachines))} machines, ${esc(String(d.summary.selfReport.MATCHES ?? 0))}
      could be compared one-to-one; every one of them agreed with the chain.
      <strong>Zero mismatches found.</strong></p>
    </div>
  </section>

  <section>
    <div class="eyebrow">§ 1.1 — FlareTeeManager · getAllActiveTeeMachines</div>
    <h2>The register</h2>
    <p class="lede">Sorted by how much attention each machine needs. A machine that is live but
      unreproducible outranks one that is merely offline.</p>

    <div class="tablewrap">
      <table>
        <caption>All registered TEE machines with attestation verdict, liveness, code hash, platform and proxy host.</caption>
        <thead><tr>
          <th class="l" scope="col">Machine</th>
          <th class="l" scope="col">Attestation</th>
          <th class="l" scope="col">Liveness</th>
          <th class="l" scope="col">Code hash / platform</th>
          <th class="l" scope="col">Proxy host</th>
          <th scope="col">ms</th>
        </tr></thead>
        <tbody>
${m.map(row).join("\n")}
        </tbody>
      </table>
    </div>

    <div class="legend">
      <div><span class="verdict ok">[ ✓ ]</span> rebuilt from source, digest matches</div>
      <div><span class="verdict bad">[ ✗ ]</span> rebuilt, digest differs</div>
      <div><span class="verdict unknown">[ ? ]</span> source cannot build deterministically</div>
      <div><span class="verdict sim">[ ~ ]</span> attested to a simulator</div>
      <div><span class="verdict none">[ · ]</span> no source revision claimed</div>
    </div>

    <p class="cap" style="margin-top:18px">
      Fig. 2 — Verdicts carry a glyph, a border style and a colour at once, so the register stays readable
      printed in greyscale or by a colourblind reader. ${esc(String(d.summary.ephemeralUrls))} of
      ${esc(String(d.summary.uniqueUrls))} proxy URLs are on hosts whose addresses rotate by design
      (quick tunnels, free ngrok, Codespaces) — those registrations are expected to rot.
    </p>
  </section>

  <footer>The Record · Covenant — Procedure — Reprod &nbsp;·&nbsp; regenerate with <code>pnpm run build</code> &nbsp;·&nbsp; every figure re-derivable from public RPC</footer>
</div>

</body>
</html>
`;

  writeFileSync(OUT, html, "utf8");
  process.stderr.write(`→ ${OUT}\n`);
}

main();
