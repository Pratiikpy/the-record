/**
 * Render the Procedure register.
 *
 * The page has to carry an auditor's vocabulary honestly: CLEAN, EXCEPTION and
 * DISCLAIMER are three different things, and a DISCLAIMER must never be styled
 * to read like a pass. That is the whole reason the layer exists.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc, short } from "../../design/src/index.js";
import { navFor } from "../../design/src/nav.js";
import type { Cv1Report, ControlResult } from "./cv1.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "cv1.json");
const FORK_GREEN = join(HERE, "..", "out", "cv1-fork-green.json");
const FORK_RED = join(HERE, "..", "out", "cv1-fork-red.json");
const OUT = join(HERE, "..", "out", "index.html");

const OPINION_CLASS: Record<string, string> = {
  CLEAN: "ok",
  EXCEPTION: "bad",
  DISCLAIMER: "unknown",
};
const OPINION_GLYPH: Record<string, string> = {
  CLEAN: "✓",
  EXCEPTION: "✗",
  DISCLAIMER: "?",
};

function opinionChip(o: string): string {
  return `<span class="verdict ${OPINION_CLASS[o] ?? "none"}">[ ${OPINION_GLYPH[o] ?? "·"} ] ${esc(o)}</span>`;
}

function controlRow(c: ControlResult): string {
  const detail = [
    ...c.exceptions.map((e) => `<div class="ex">✗ ${esc(e)}</div>`),
    c.disclaimer ? `<div class="dis">? ${esc(c.disclaimer)}</div>` : "",
    c.observation ? `<div class="obs">· ${esc(c.observation)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `<tr>
    <th scope="row">${esc(c.id)}<small>${esc(c.title)}</small></th>
    <td class="l">${opinionChip(c.opinion)}</td>
    <td class="l assertion">${esc(c.assertion)}${detail}</td>
    <td>${c.tested}</td>
  </tr>`;
}

/**
 * A short form for the headline slot.
 *
 * The full figure is 140,000,000 XRP, which wrapped onto a second line and
 * made its card taller than the three beside it. The exact number moves to
 * the subline rather than being lost — a stat that rounds without saying so
 * is the kind of small dishonesty this project should not ship.
 */
function compactXrp(uba: string): string {
  const whole = Number(BigInt(uba) / 1_000_000n);
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(whole % 1_000_000 === 0 ? 0 : 1)}M XRP`;
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(whole % 1_000 === 0 ? 0 : 1)}k XRP`;
  return `${whole.toLocaleString("en-US")} XRP`;
}

/** XRP is 6 decimals in UBA. */
const xrp = (uba: string): string =>
  (Number(BigInt(uba) / 1000n) / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * § 3.3 — the red run.
 *
 * The single question this layer could not previously answer: *has your control
 * ever gone red?* A monitor that has only ever printed CLEAN is
 * indistinguishable from one that CANNOT print anything else — and this
 * procedure has already shipped exactly that failure once, an identity between
 * two figures that both derived from the same storage slot.
 *
 * So the section is not a claim. It is a before and after, from a run anyone
 * can repeat with one command.
 */
function redRunSection(green: Cv1Report, red: Cv1Report): string {
  const pair = (id: string): [ControlResult | undefined, ControlResult | undefined] => [
    green.controls.find((c) => c.id === id),
    red.controls.find((c) => c.id === id),
  ];
  const ids = green.controls.map((c) => c.id);
  const c3red = red.controls.find((c) => c.id === "C3");

  // Three columns, not four. A "behaviour" column would only restate what the
  // two chips already show, and it pushed the RED column — the entire point of
  // the table — off the right edge of a phone screen.
  const rows = ids
    .map((id) => {
      const [g, r] = pair(id);
      const changed = g?.opinion !== r?.opinion;
      const note = changed ? "fired on the injected fault" : "not in the fault's scope";
      return `<tr${changed ? ' class="changed"' : ""}>
        <th scope="row">${esc(id)}<small>${esc(g?.title ?? "")}</small><small>${note}</small></th>
        <td class="l">${opinionChip(g?.opinion ?? "—")}</td>
        <td class="l">${opinionChip(r?.opinion ?? "—")}</td>
      </tr>`;
    })
    .join("\n");

  return `
  <section>
    <div class="eyebrow">§ 3.3 — Falsification</div>
    <h2>The control has gone red, on purpose</h2>
    <p class="lede">Coston2 is forked locally, one storage slot in
      <code>CoreVaultManager</code> is overwritten, and the identical procedure runs again. The XRP Ledger
      is left completely untouched and real — that asymmetry is the point, because a cross-chain fault only
      surfaces when the two sources are genuinely independent.</p>

    <div class="stats">
      ${stat("Injected fault", "1 slot", "escrowedFunds 500,000,000,000 → 999,999,999,999")}
      ${stat("Opinion under fault", red.opinion, `was ${green.opinion} — same code, same XRPL evidence`)}
      ${stat("Evidence digest", `${esc(green.evidence.evidenceDigest)}`, `→ ${esc(red.evidence.evidenceDigest)}`)}
      ${stat("Controls moved", "1 of 5", "the other four correctly did not")}
    </div>

    <div class="tablewrap" style="margin-top:20px">
      <table class="cmp" style="min-width:320px">
        <caption>Every control before and after the injected fault. Only the control whose scope contains the fault moves.</caption>
        <thead><tr>
          <th class="l" scope="col">Control</th>
          <th class="l" scope="col">Before</th>
          <th class="l" scope="col">After</th>
        </tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>

    ${
      c3red && c3red.exceptions.length > 0
        ? `<div class="finding">
      <div class="finding-label">The exception it wrote, verbatim</div>
      <p class="finding-body">${esc(c3red.exceptions[0]!)}</p>
    </div>`
        : ""
    }

    <div class="note">
      <p><span class="tag">Why this section exists</span>An earlier version of C3 asserted
      <code>escrowedFunds = totalAvailable − immediatelyAvailable</code>. It held exactly, every period. It
      also <strong>could not fail</strong>: <code>coreVaultAvailableAmount()</code> derives both of its
      outputs from that same <code>escrowedFunds</code>, so this very fault injection moved both sides of
      the identity together and the control stayed green. It had been printing CLEAN for reasons having
      nothing to do with the vault's health.</p>
      <p>Four controls do not move under this fault. That matters as much as the one that does — a check
      that fires on everything is no more informative than one that fires on nothing.</p>
      <p><strong>Reproduce it:</strong> <code>pnpm --filter @therecord/procedure redrun</code>. The script
      exits non-zero if C3 stays CLEAN, so a control that stops being able to fail breaks the build.</p>
    </div>

    <p class="cap" style="margin-top:22px">
      The same procedure has also been run backwards, across 119 historical heights on both chains —
      where it reports exceptions this register was not running to see.
      <a class="cite" href="backfill.html">[ The backfilled series → ]</a>
    </p>
  </section>`;
}

function main(): void {
  const r = JSON.parse(readFileSync(IN, "utf8")) as Cv1Report;
  const s = r.state;

  const body = `
  <section>
    ${marker("Procedure · CV-1")}
    <h1>The practitioner is a program, and it is allowed to refuse.</h1>
    <p class="lede">The FAssets Core Vault is a Flare-governed multisig on XRPL, operated by human signers
      in daily windows. It is the most audit-relevant surface in the stack, and there is no record of
      whether its documented controls hold. CV-1 tests them every period — from entirely public data,
      needing no client, no credentials and nobody's permission.</p>

    <div class="stats">
      ${stat("Opinion", r.opinion, `${r.controls.length} controls · ${esc(r.network?.label ?? "Flare")}`)}
      ${stat("Outflows tested", String(r.evidence.outflows), `of ${r.evidence.xrplTransactions} XRPL txs`)}
      ${stat(
        "Under test",
        compactXrp(s.escrowedFundsUBA),
        `${xrp(s.escrowedFundsUBA)} XRP escrowed · ${xrp(s.availableFundsUBA)} available${r.network?.isMainnet ? " · real value on mainnet" : ""}`,
      )}
      ${stat("Allowlist", String(s.allowedDestinations.length), "permitted destinations")}
    </div>

    <p class="cap" style="margin-top:14px">
      Fig. 1 — CV-1 at ${esc(r.period)} on <strong>${esc(r.network?.label ?? "Flare")}</strong>${r.network ? ` (chain ${r.network.chainId})` : ""}. Vault <code>${esc(s.coreVaultAddress)}</code>,
      custodian <code>${esc(s.custodianAddress)}</code>. Evidence digest
      <code>${esc(r.evidence.evidenceDigest)}</code>${r.evidence.ledgerRange ? ` · XRPL ledgers ${r.evidence.ledgerRange[0]}–${r.evidence.ledgerRange[1]}` : ""}.
    </p>

    <div class="note">
      <p><span class="tag">Three outcomes, not two</span><strong>CLEAN</strong> means the control was tested and held.
      <strong>EXCEPTION</strong> means it was tested and did not. <strong>DISCLAIMER</strong> means there was not
      enough evidence to conclude — and it is never rolled up as a pass. A procedure that can only produce good
      news is marketing, so refusing to conclude is a first-class result.</p>
      <p><strong>Three corrections we made to ourselves.</strong> The cross-chain reconciliation has been
      wrong three times, and the wrongness was instructive each time.
      <em>(i)</em> It asserted <code>availableFunds + escrowedFunds ≤ totalAvailable</code> across two
      contracts and reported a 400&nbsp;UBA <em>exception against Flare</em> — figures never defined to relate;
      the 400&nbsp;UBA is a fee the asset manager nets off, now <em>disclosed</em> as C5 rather than judged.
      <em>(ii)</em> It asserted <code>escrowedFunds = totalAvailable − immediatelyAvailable</code>, which held
      exactly and could never fail, because both sides derive from one storage slot (§&nbsp;3.3).
      <em>(iii)</em> It asserted <code>availableFunds + escrowedFunds ≤ Balance</code> and produced a
      497,844,875,522&nbsp;drop shortfall — <strong>caught before publication</strong>: XRPL escrow
      <em>removes</em> XRP from the account balance and holds it in Escrow objects, so adding Flare's escrowed
      figure to a balance that already excludes it double-counts every escrow.</p>
      <p>C3 now reconciles the two things that genuinely must agree — Flare's <code>escrowedFunds</code>
      against the sum of the vault's Escrow objects on XRPL, which on live data match to the drop — and C4
      compares Flare's spendable claim against the liquid balance after the ledger's own reserve. A false
      accusation is far more damaging to an assurance register than a missed finding.</p>
      <p>Every correction this project has ever made is published in full, including the ones that reached
      the public before being withdrawn. <a class="cite" href="../errata">[ Read the errata → ]</a></p>
    </div>
  </section>

  <section>
    <div class="eyebrow">§ 3.1 — Controls</div>
    <h2>What was tested, and what it asserts</h2>

    <div class="tablewrap">
      <table style="min-width:820px">
        <caption>CV-1 control results with the assertion tested, opinion, exceptions and sample size.</caption>
        <thead><tr>
          <th class="l" scope="col">Control</th>
          <th class="l" scope="col">Opinion</th>
          <th class="l" scope="col">Assertion</th>
          <th scope="col">Tested</th>
        </tr></thead>
        <tbody>
${r.controls.map(controlRow).join("\n")}
        </tbody>
      </table>
    </div>

    <div class="legend">
      <div><span class="verdict ok">[ ✓ ]</span> tested and held</div>
      <div><span class="verdict bad">[ ✗ ]</span> tested and breached</div>
      <div><span class="verdict unknown">[ ? ]</span> insufficient evidence — not a pass</div>
    </div>

    <p class="cap" style="margin-top:18px">
      Fig. 2 — Every input is public: the allowlist, custodian and balances from Flare, the payments from
      XRPL. No client had to agree to be audited, which is what lets continuous assurance start at all.
    </p>
  </section>

  <section>
    <div class="eyebrow">§ 3.2 — Permitted destinations</div>
    <h2>The allowlist under test</h2>
    <div class="tablewrap">
      <table style="min-width:520px">
        <caption>Addresses the Core Vault is permitted to pay, read from Flare at test time.</caption>
        <thead><tr>
          <th class="l" scope="col">Address</th>
          <th class="l" scope="col">Role</th>
        </tr></thead>
        <tbody>
          <tr><th scope="row"><code>${esc(s.coreVaultAddress)}</code></th><td class="l">core vault (payer)</td></tr>
          <tr><th scope="row"><code>${esc(s.custodianAddress)}</code></th><td class="l">custodian — permitted by construction</td></tr>
${s.allowedDestinations.map((a) => `          <tr><th scope="row"><code>${esc(a)}</code></th><td class="l">allowlisted destination</td></tr>`).join("\n")}
        </tbody>
      </table>
    </div>
    <p class="cap" style="margin-top:18px">
      Fig. 3 — The custodian is permitted by construction and is deliberately not in the destination
      allowlist; C2 tests that both are actually set, so C1 cannot pass for the wrong reason.
    </p>
  </section>
${
  existsSync(FORK_GREEN) && existsSync(FORK_RED)
    ? redRunSection(
        JSON.parse(readFileSync(FORK_GREEN, "utf8")) as Cv1Report,
        JSON.parse(readFileSync(FORK_RED, "utf8")) as Cv1Report,
      )
    : ""
}`;

  writeFileSync(
    OUT,
    page({
      title: "Procedure — CV-1 Core Vault controls",
      description:
        "Continuous control testing of the FAssets Core Vault on Flare, from entirely public data. CLEAN, EXCEPTION or DISCLAIMER.",
      section: "procedure",
      meta: `CV-1 · period ${r.period} · evidence ${r.evidence.evidenceDigest}`,
      nav: navFor("procedure"),
      body,
      extraCss:
        ".assertion{max-width:52ch}.ex,.dis,.obs{font-size:11px;margin-top:6px;line-height:1.5}" +
        ".ex{color:var(--v-bad)}.dis{color:var(--v-unknown)}.obs{color:var(--faint)}" +
        "tr.changed th,tr.changed td{background:var(--wash)}" +
        // The one sentence that proves the control works should not be set as a
        // full-bleed 11px caption. It gets the width of a paragraph and a rule.
        ".finding{margin-top:20px;border-left:2px solid var(--v-bad);padding:2px 0 2px 16px;max-width:62ch}" +
        ".finding-label{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}" +
        ".finding-body{font-family:var(--mono);font-size:12px;line-height:1.7;color:var(--v-bad);margin:6px 0 0;overflow-wrap:anywhere}" +
        // The comparison table is the one table that must fit a phone without
        // sideways scrolling: a reader who sees only the BEFORE column reads
        // five CLEANs and concludes the opposite of what the section proves.
        "@media (max-width:480px){.cmp th,.cmp td{padding-left:9px;padding-right:9px}.cmp .verdict{font-size:10px;padding:2px 5px}}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();



