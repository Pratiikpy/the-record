/**
 * THE RECORD — shared page shell.
 *
 * One source of truth for the design system described in DESIGN.md, so the
 * Covenant and Reprod registers cannot drift apart. Every token here is
 * measured, not inherited: see `CONTRAST` for the WCAG figures and the test in
 * packages/reprod/test/contrast.test.ts that parses the rendered output.
 */

/** Measured contrast ratios against the page ground. AA floor for small text is 4.5. */
export const CONTRAST: Record<string, { light: number; dark: number }> = {
  ink: { light: 15.8, dark: 14.9 },
  muted: { light: 8.78, dark: 8.1 },
  faint: { light: 5.34, dark: 5.13 },
  "v-ok": { light: 5.56, dark: 6.2 },
  "v-bad": { light: 7.22, dark: 5.4 },
};

export const TOKENS = `
:root{--ink:#1F1E1D;--ink-soft:#2C2A28;--paper:#FAF9F5;--muted:#4A4742;--graphite:#6E6A64;--faint:#6B6760;
--rule:rgb(31 30 29/.15);--rule-strong:rgb(31 30 29/.25);--rule-dashed:rgb(31 30 29/.30);--wash:rgb(31 30 29/.04);
--v-ok:#3F6F4B;--v-bad:#8C3A2E;--v-unknown:#6B6760;--v-sim:#7A6A3F;
--serif:"IBM Plex Serif",Georgia,"Times New Roman",serif;
--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
:root[data-theme="dark"]{--ink:#EDEAE3;--ink-soft:#D9D5CC;--paper:#161512;--muted:#B3AEA3;--graphite:#918B80;--faint:#8C867A;
--rule:rgb(237 234 227/.15);--rule-strong:rgb(237 234 227/.26);--rule-dashed:rgb(237 234 227/.32);--wash:rgb(237 234 227/.05);
--v-ok:#7FA98A;--v-bad:#CE8272;--v-unknown:#8C867A;--v-sim:#B7A06A}
:root[data-theme="light"]{--ink:#1F1E1D;--paper:#FAF9F5;--muted:#4A4742;--graphite:#6E6A64;--faint:#6B6760;
--rule:rgb(31 30 29/.15);--rule-strong:rgb(31 30 29/.25);--rule-dashed:rgb(31 30 29/.30);--wash:rgb(31 30 29/.04);
--v-ok:#3F6F4B;--v-bad:#8C3A2E;--v-unknown:#6B6760;--v-sim:#7A6A3F}`;

export const BASE_CSS = `
*{box-sizing:border-box}
/* Keyboard users should not have to tab the whole register nav on every page.
   Off-screen until focused, then it lands in the flow rather than over it. */
.skip{position:absolute;left:-9999px;top:0;font-family:var(--mono);font-size:13px;
  background:var(--ink);color:var(--paper);padding:10px 16px;z-index:10;text-decoration:none}
.skip:focus{left:8px;top:8px}
main{display:block}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-weight:300;font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}
.shell{max-width:1180px;margin-inline:auto;padding-inline:24px}
.masthead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:16px}
.brand{display:flex;align-items:center;gap:10px}
.mark{position:relative;width:20px;height:20px;flex:none}
.mark span{position:absolute;width:8px;height:8px;border-radius:2px;background:var(--ink)}
.mark span:nth-child(1){top:0;left:0}.mark span:nth-child(2){top:0;right:0;opacity:.55}
.mark span:nth-child(3){bottom:0;left:0;opacity:.55}.mark span:nth-child(4){bottom:0;right:0;opacity:.25}
.wordmark{font-family:var(--mono);font-size:14px;font-weight:500;letter-spacing:.02em}
nav.top{display:flex;gap:20px;font-family:var(--mono);font-size:13px}
nav.top a{color:var(--ink);text-decoration:none;transition:color .2s}
nav.top a:hover,nav.top a[aria-current]{color:var(--faint)}
/* A choice, not an accident of the viewer's operating system. The paper
   palette is the design — it is what the pages were proportioned and
   contrast-checked for, and what they print as. */
.themetoggle{font-family:var(--mono);font-size:13px;color:var(--ink);background:none;border:0;
padding:0;cursor:pointer;transition:color .2s}
.themetoggle:hover{color:var(--faint)}
/* The tier sits with the subject it grades. Border and text carry it, never
   colour alone -- these pages must survive greyscale printing. */
/* align-self, not display: .reg is a column flex container, which blockifies
   its children -- inline-block is ignored and align-items:stretch pulls the
   badge to the full card width. */
.tier{align-self:flex-start;font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;
padding:3px 8px;border:1px solid var(--rule-strong);margin:0 0 10px;color:var(--muted)}
.tier.t3{border-color:var(--v-ok);color:var(--v-ok)}
.tier.t2{border-color:var(--v-sim);color:var(--v-sim)}
.tier.t1,.tier.t0{border-style:dashed;color:var(--v-unknown)}
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
/* minmax(0,1fr), never 1fr: a bare 1fr floors at min-content, so one long
   unbreakable value -- an evidence digest, an address -- widens its column
   past the container and silently clips the grid at 390px. */
.stats{margin-top:40px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--rule-strong);border:1px solid var(--rule-strong)}
@media(max-width:820px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.stat{background:var(--paper);padding:22px 20px}
.stat .k{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint)}
.stat .v{font-family:var(--serif);font-weight:300;font-size:clamp(26px,4.4vw,36px);line-height:1.05;letter-spacing:-.02em;margin-top:10px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.stat .n{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:8px}
.tablewrap{overflow-x:auto;margin-top:18px;border:1px solid var(--rule-strong)}
table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12.5px}
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
  nav.top{gap:14px;flex-wrap:wrap}
  section{padding-block:44px}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .legend{gap:8px 16px}
  .stat .k{min-height:3.4em}
}
@media print{body{background:#fff;color:#000}.tablewrap{overflow:visible;border:0}table{font-size:9px}}
@media(prefers-reduced-motion:reduce){*,::before,::after{transition-duration:.001ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}}`;

export const esc = (s: string): string =>
  s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const short = (h: string, n = 10): string =>
  h.length > n + 4 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;

export function marker(label: string): string {
  return `<div class="marker"><b aria-hidden="true">+</b><b aria-hidden="true">+</b><b aria-hidden="true">+</b><b aria-hidden="true">+</b><span>${esc(label)}</span></div>`;
}

export function stat(k: string, v: string, n: string): string {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="n">${esc(n)}</div></div>`;
}

export interface PageOpts {
  title: string;
  description: string;
  /** wordmark suffix, e.g. "covenant" */
  section: string;
  meta: string;
  nav: ReadonlyArray<{ label: string; href: string; current?: boolean }>;
  body: string;
  extraCss?: string;
}

/**
 * The masthead mark, as a favicon.
 *
 * With no `<link rel="icon">` a browser silently requests /favicon.ico, and
 * ours answered 404 on every single page view -- a console error on the landing
 * page and a blank tab in every bookmark. Inlined as a data URI so it cannot
 * 404, cannot drift from the mark it copies, and costs no request.
 *
 * The four squares carry the same descending opacity as `.mark`: the register
 * is one thing observed at four decreasing degrees of certainty.
 */
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
      '<rect width="20" height="20" rx="3" fill="#FAF9F5"/>' +
      '<g fill="#1F1E1D">' +
      '<rect x="2" y="2" width="8" height="8" rx="2"/>' +
      '<rect x="11" y="2" width="8" height="8" rx="2" opacity=".55"/>' +
      '<rect x="2" y="11" width="8" height="8" rx="2" opacity=".55"/>' +
      '<rect x="11" y="11" width="8" height="8" rx="2" opacity=".25"/>' +
      "</g></svg>",
  );

export function page(o: PageOpts): string {
  const nav = o.nav
    .map((n) => `<a href="${esc(n.href)}"${n.current ? ' aria-current="page"' : ""}>[${esc(n.label)}]</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(o.description)}">
<meta name="color-scheme" content="light">
<link rel="icon" href="${FAVICON}">
<title>${esc(o.title)}</title>
<style>${TOKENS}${BASE_CSS}${o.extraCss ?? ""}</style>
<script>(function(){try{var t=localStorage.getItem("record-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <header class="masthead">
    <div class="brand">
      <div class="mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <span class="wordmark">the record · ${esc(o.section)}</span>
    </div>
    <nav class="top" aria-label="Registers">${nav}<button class="themetoggle" type="button" data-toggle-theme aria-label="Toggle light or dark">[◐]</button></nav>
  </header>
  <main id="main">
${o.body}
  </main>
  <footer>The Record · Covenant — Procedure — Reprod &nbsp;·&nbsp; ${esc(o.meta)} &nbsp;·&nbsp; every figure re-derivable from public RPC</footer>
</div>
<script>(function(){var b=document.querySelector("[data-toggle-theme]");if(!b)return;
b.addEventListener("click",function(){var r=document.documentElement;
var next=r.getAttribute("data-theme")==="dark"?"light":"dark";
r.setAttribute("data-theme",next);try{localStorage.setItem("record-theme",next)}catch(e){}})})()</script>
</body>
</html>
`;
}
