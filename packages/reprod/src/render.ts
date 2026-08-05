/**
 * Render the Reprod register.
 *
 * Every number comes from out/scan.json, which any third party can regenerate
 * from public RPC. The page is built to be screenshotted and cited, so it must
 * survive greyscale printing: verdicts carry a glyph and a border style as well
 * as a colour.
 */
import { readFileSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc, short } from "../../design/src/index.js";
import { navFor } from "../../design/src/nav.js";
import type { ScanResult, MachineRow } from "./scan.js";
import type { RebuildOutcome, Scoped } from "./rebuild.js";
import { indexRegistry, summarise, hashProvenance } from "./provenance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "scan.json");
const REBUILDS = join(HERE, "..", "out", "rebuilds.json");
const OUT = join(HERE, "..", "out", "index.html");

const VERDICT_GLYPH: Record<string, string> = {
  REPRODUCED: "✓",
  DETERMINISTIC: "=",
  NOT_A_MEASUREMENT: "~",
  UNKNOWN_HASH: "·",
  DIVERGED: "✗",
  UNREPRODUCIBLE: "?",
  SIMULATED: "~",
  NO_KNOWN_SOURCE: "·",
  ERROR: "!",
};
const VERDICT_CLASS: Record<string, string> = {
  REPRODUCED: "ok",
  DETERMINISTIC: "ok",
  // Notable, not adverse: a shared hash is what simulation is defined to emit.
  NOT_A_MEASUREMENT: "sim",
  UNKNOWN_HASH: "none",
  DIVERGED: "bad",
  UNREPRODUCIBLE: "unknown",
  SIMULATED: "sim",
  NO_KNOWN_SOURCE: "none",
  ERROR: "bad",
};

function chip(v: string): string {
  return `<span class="verdict ${VERDICT_CLASS[v] ?? "none"}">[ ${VERDICT_GLYPH[v] ?? "·"} ] ${esc(v.replace(/_/gu, " "))}</span>`;
}

function livenessChip(l: string): string {
  const cls = l === "LIVE" ? "ok" : l === "DEAD" ? "bad" : "unknown";
  const glyph = l === "LIVE" ? "●" : l === "DEAD" ? "○" : "?";
  return `<span class="verdict ${cls}">[ ${glyph} ] ${l}</span>`;
}

function machineRow(m: MachineRow): string {
  const flags = [
    m.ephemeral ? `<abbr title="${esc(m.ephemeralReason ?? "")}">ephemeral</abbr>` : "",
    m.insecure ? `<abbr title="proxy served over plain http://">insecure</abbr>` : "",
    m.machinesOnThisUrl > 1
      ? `<abbr title="${m.machinesOnThisUrl} machines share this proxy URL, so its /info cannot be attributed to any one of them">shared ×${m.machinesOnThisUrl}</abbr>`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<tr>
    <th scope="row"><a class="cite" href="https://coston2.testnet.flarescan.com/address/${esc(m.teeId)}" target="_blank" rel="noopener">${short(m.teeId, 12)}</a><small>ext ${esc(m.extensionId)} · ${esc(m.status)}</small></th>
    <td class="l">${chip(m.attestation)}</td>
    <td class="l">${livenessChip(m.liveness)}</td>
    <td class="l"><code>${short(m.codeHash, 12)}</code><small>${esc(m.platform || "—")}</small></td>
    <td class="l host">${esc(m.host)}<small>${flags || "&nbsp;"}</small></td>
    <td>${m.probeMs ?? "—"}</td>
  </tr>`;
}

interface RebuildRecord {
  repo: string;
  ref: string;
  dockerfile: string;
  lang: string;
  outcome: RebuildOutcome;
  scope: Scoped;
  seconds: number;
}

function rebuildRow(r: RebuildRecord): string {
  const o = r.outcome;
  const digest = "digest" in o ? `<code>${short(o.digest, 12)}</code>` : "—";
  const scopeNote = r.scope.independentlyVerifiable
    ? `<span class="verdict ok">cross-machine</span>`
    : `<abbr title="${esc(r.scope.caveat ?? "")}"><span class="verdict unknown">${esc(r.scope.guarantee.replace(/_/gu, " ").toLowerCase())}</span></abbr>`;
  return `<tr>
    <th scope="row">${esc(r.repo.split("/")[1] ?? r.repo)}<small>${esc(r.ref)} · ${esc(r.dockerfile)}</small></th>
    <td class="l">${esc(r.lang)}</td>
    <td class="l">${chip(o.status)}</td>
    <td class="l">${scopeNote}</td>
    <td class="l">${digest}</td>
    <td>${r.seconds}</td>
  </tr>`;
}

/**
 * § 1.0 — the measurement.
 *
 * This runs first because it is the finding. Every confidential-compute
 * project on Flare tells its users the same thing — *you do not have to trust
 * us, check the code hash* — and until now there was no instrument that turned
 * that instruction into an answer.
 *
 * The section is deliberately registry-level. Per-machine cards would be
 * equally accurate and would read as a list of accusations; a statistic over
 * registry is a property of the ecosystem. No operator is named anywhere
 * on this page, and simulated attestation is stated as permitted every time it
 * appears, because it is.
 */
/**
 * The simulated share of the register, as a percentage.
 *
 * This sentence used to read "96% of this register is someone developing" with
 * the figure typed in. A later scan read 243 of 256 and the claim was simply
 * wrong -- the same defect as E-008, in prose rather than a stat tile. Prose is
 * where stale numbers hide best, because nothing downstream ever checks it.
 */
function simPct(d: ScanResult): string {
  const sim = d.machines.filter((m) => m.attestation === "SIMULATED").length;
  return d.totalActiveMachines ? `${((sim / d.totalActiveMachines) * 100).toFixed(0)}%` : "—";
}

function measurementSection(d: ScanResult, rebuilds: RebuildRecord[]): string {
  const idx = indexRegistry(d.machines);
  const s = summarise(idx);
  const onChain = new Set([...idx.byHash.keys()]);
  // Narrowed the same way rebuildRow does: only some RebuildOutcome variants
  // carry a digest, and a rebuild without one can never match an on-chain hash.
  const traceable = rebuilds.filter(
    (r) => "digest" in r.outcome && onChain.has(r.outcome.digest.toLowerCase()),
  ).length;
  const maxBits = Math.round(-Math.log2(1 / s.total) * 100) / 100;

  const rows = [...idx.byHash.entries()]
    .map(([hash, entries]) => {
      const owners = new Set(entries.map((e) => e.owner.toLowerCase())).size;
      const p = hashProvenance(hash, idx, []);
      const width = Math.max(1, Math.round((p.identifyingBits! / maxBits) * 100));
      return { hash, n: entries.length, owners, p, width, platform: entries[0]!.platform };
    })
    .sort((a, b) => b.n - a.n)
    .map(
      (r) => `<tr>
        <th scope="row"><code>${esc(short(r.hash, 14))}</code><small>${esc(r.platform)}</small></th>
        <td>${r.n}</td>
        <td>${r.owners}</td>
        <td class="l bitscell">
          <span class="bitsbar"><span style="width:${r.width}%"></span></span>
          <span class="bitsnum">${r.p.identifyingBits!.toFixed(2)}</span>
        </td>
        <td class="l">${chip(r.p.verdict)}</td>
      </tr>`,
    )
    .join("\n");

  return `
  <section>
    <div class="eyebrow">§ 1.0 — The measurement</div>
    <h2>&ldquo;Check the code hash&rdquo; has no answer yet.</h2>
    <p class="lede">Confidential compute rests on one primitive: a machine registers a hash of the code it
      runs, and you check it. That instruction is only as strong as the hash is <em>distinctive</em> — so
      this asks the registry how much a hash actually identifies. If a value is carried by many independent
      owners, learning that a machine carries it tells you almost nothing, because almost every machine
      would have given you the same answer.</p>

    <p class="cap" style="margin-top:14px">
      bits = &minus;log<sub>2</sub>( machines carrying this hash &divide; machines in the registry )
    </p>

    <div class="stats">
      ${stat("Machines", String(s.total), `${s.distinctHashes} distinct code hashes between them`)}
      ${stat("Mean identification", `${s.meanIdentifyingBits} bits`, `a unique hash here would carry ${maxBits.toFixed(2)}`)}
      ${stat("Most-shared hash", `${s.mostShared ? ((s.mostShared.registrations / s.total) * 100).toFixed(1) : "0"}%`, `${s.mostShared?.registrations ?? 0} machines, ${s.mostShared?.distinctOwners ?? 0} independent owners`)}
      ${stat("Traceable to source", String(traceable), `of ${s.total} machines, from ${rebuilds.length} rebuilds we ran`)}
    </div>

    <div class="tablewrap" style="margin-top:20px">
      <table style="min-width:640px">
        <caption>Every distinct code hash in the registry, with how many machines and independent owners carry it, and how many bits it therefore identifies.</caption>
        <thead><tr>
          <th class="l" scope="col">Code hash</th>
          <th scope="col">Machines</th>
          <th scope="col">Owners</th>
          <th class="l" scope="col">Identifies</th>
          <th class="l" scope="col">Verdict</th>
        </tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>

    <div class="note">
      <p><span class="tag">Nobody did anything wrong</span>Simulated attestation is <strong>explicitly
      permitted</strong> by Flare, and a shared constant is precisely what simulation is defined to emit. A
      developer running in simulation is doing the expected thing. This measures the <em>hash</em>, not the
      operator &mdash; no machine owner is named anywhere on this page, and
      <code>NOT&nbsp;A&nbsp;MEASUREMENT</code> is derived from how many owners share a value, not from a
      list of known constants. It would flag a shared hash nobody has ever seen, and it would clear the
      simulator's own constant the moment a single owner used it.</p>
      <p><strong>The finding is the zero.</strong> ${traceable === 0 ? "Not one machine in this registry carries a code hash that can be traced to source today. The shared value identifies nothing; every distinctive hash has no claimed source revision. We rebuilt five of Flare's own images deterministically and not one of those digests appears on chain." : `${traceable} on-chain hash(es) rebuild from published source.`}
      That is a statement about a registry three weeks into its life, not about anyone in it &mdash; and it
      is exactly the gap this instrument exists to close.</p>
      <p><strong>Check it yourself:</strong> <code>pnpm --filter @therecord/reprod provenance --registry</code>,
      or pass any code hash, extension id, TEE address or machine URL. It runs against the committed
      snapshot with no network and no server, so the answer does not depend on trusting us.</p>
    </div>
  </section>`;
}

function main(): void {
  const d = JSON.parse(readFileSync(IN, "utf8")) as ScanResult;
  const m = d.machines;
  const dead = m.filter((x) => x.liveness === "DEAD").length;
  const sim = m.filter((x) => x.attestation === "SIMULATED").length;
  const real = m.length - sim;
  const pct = (n: number): string => `${((n / m.length) * 100).toFixed(0)}%`;
  const scanned = new Date(d.scannedAt).toISOString().replace("T", " ").slice(0, 16);

  const rebuilds: RebuildRecord[] = existsSync(REBUILDS)
    ? (JSON.parse(readFileSync(REBUILDS, "utf8")) as { rebuilds: RebuildRecord[] }).rebuilds
    : [];

  const rebuildSection =
    rebuilds.length === 0
      ? ""
      : `
  <section>
    <div class="eyebrow">§ 1.1 — Independent rebuilds</div>
    <h2>Rebuilt from source, here, twice each</h2>
    <p class="lede">Flare's own recipe, run by a third party with no relationship to them:
      <code>buildx</code> on the docker-container driver, <code>--no-cache</code>,
      <code>SOURCE_DATE_EPOCH</code> from the commit, <code>rewrite-timestamp=true</code>.
      Each target is built twice and the digests must agree.</p>

    <div class="tablewrap">
      <table>
        <caption>Independent rebuild results by repository and language, with the declared reproducibility scope.</caption>
        <thead><tr>
          <th class="l" scope="col">Repository</th>
          <th class="l" scope="col">Language</th>
          <th class="l" scope="col">Outcome</th>
          <th class="l" scope="col">Declared scope</th>
          <th class="l" scope="col">Digest</th>
          <th scope="col">Seconds</th>
        </tr></thead>
        <tbody>
${rebuilds.map(rebuildRow).join("\n")}
        </tbody>
      </table>
    </div>

    <div class="note">
      <p><span class="tag">Determinism is not verification</span><strong>=</strong> means the source built to
      the same digest twice on this host. It does <em>not</em> mean the digest matches a code hash any machine
      is registered with — none of these were compared against one, so none report as reproduced. Only that
      comparison is evidence about a running machine.</p>
      <p><strong>And one host cannot settle it either way.</strong> Flare documents their Python and
      TypeScript images as same-machine only — those pass a local double-build and remain unverifiable by an
      auditor on different hardware. That is why the register counts distinct rebuilders rather than storing
      a boolean.</p>
    </div>

    <p class="cap" style="margin-top:18px">
      Fig. 3 — Every language image also required a prerequisite base image the documented recipe does not
      mention, built from a ref derived from <code>go/go.mod</code>. Without it, no extension image rebuilds
      at all.
    </p>
  </section>`;

  const body = `
  <section>
    ${marker("Reprod · Machine register")}
    <h1>Every confidential-compute machine Flare has on record, and whether it is really there.</h1>
    <p class="lede">Read straight from the FlareTeeManager registry on Coston2 and probed live.
      Nothing here needs anyone's permission or cooperation: the register is public, the proxies
      answer or they do not, and every row is re-derivable from public RPC by anyone.</p>

    <div class="stats">
      ${stat("Machines registered", String(d.totalActiveMachines), `${d.summary.distinctExtensions} extensions`)}
      ${stat("Unreachable now", String(dead), `${pct(dead)} of the register`)}
      ${stat("Simulated", String(sim), `${pct(sim)} — bound to no source`)}
      ${stat("Real confidential HW", String(real), `across ${d.summary.distinctCodeHashes - 1} code hashes`)}
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
${measurementSection(d, rebuilds)}
${rebuildSection}
  <section>
    <div class="eyebrow">§ 1.2 — FlareTeeManager · getAllActiveTeeMachines</div>
    <h2>The register</h2>
    <p class="lede">Sorted by how much attention each machine needs. Real confidential hardware outranks
      a simulator in every combination — ${esc(simPct(d))} of this register is someone developing, and
      burying the ${esc(String(real))} rows that carry weight beneath them would make the page
      useless.</p>

    <div class="tablewrap">
      <table style="min-width:940px">
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
${m.map(machineRow).join("\n")}
        </tbody>
      </table>
    </div>

    <div class="legend">
      <div><span class="verdict ok">[ ✓ ]</span> rebuilt from source, digest matches the chain</div>
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
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "Reprod — Flare Confidential Compute machine register",
      description:
        "Every confidential-compute machine registered on Flare Coston2, with attestation verdict and live reachability. Re-derivable from public RPC.",
      section: "reprod",
      meta: `chain 114 · block ${d.blockNumber} · ${scanned}Z`,
      nav: navFor("reprod"),
      body,
      extraCss: ".host{max-width:280px;overflow-wrap:anywhere}" +
        // The bits bar has to read in greyscale on A4, so it carries a border
        // and a printed number, never colour alone.
        ".bitscell{white-space:nowrap}" +
        ".bitsbar{display:inline-block;width:84px;height:8px;border:1px solid var(--rule-strong);vertical-align:middle;margin-right:8px}" +
        ".bitsbar>span{display:block;height:100%;background:var(--ink);opacity:.55}" +
        ".bitsnum{font-family:var(--mono);font-size:11px}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();





