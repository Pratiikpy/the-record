/**
 * Render the Procedure register.
 *
 * The page has to carry an auditor's vocabulary honestly: CLEAN, EXCEPTION and
 * DISCLAIMER are three different things, and a DISCLAIMER must never be styled
 * to read like a pass. That is the whole reason the layer exists.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc, short } from "../../design/src/index.js";
import { navFor } from "../../design/src/nav.js";
import type { Cv1Report, ControlResult } from "./cv1.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "cv1.json");
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

/** XRP is 6 decimals in UBA. */
const xrp = (uba: string): string =>
  (Number(BigInt(uba) / 1000n) / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 });

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
      ${stat("Opinion", r.opinion, `${r.controls.length} controls, period ${r.period}`)}
      ${stat("Outflows tested", String(r.evidence.outflows), `of ${r.evidence.xrplTransactions} XRPL txs`)}
      ${stat("Vault holdings", xrp(s.availableFundsUBA), `XRP available · ${xrp(s.escrowedFundsUBA)} escrowed`)}
      ${stat("Allowlist", String(s.allowedDestinations.length), "permitted destinations")}
    </div>

    <p class="cap" style="margin-top:14px">
      Fig. 1 — CV-1 at ${esc(r.period)}. Vault <code>${esc(s.coreVaultAddress)}</code>,
      custodian <code>${esc(s.custodianAddress)}</code>. Evidence digest
      <code>${esc(r.evidence.evidenceDigest)}</code>${r.evidence.ledgerRange ? ` · XRPL ledgers ${r.evidence.ledgerRange[0]}–${r.evidence.ledgerRange[1]}` : ""}.
    </p>

    <div class="note">
      <p><span class="tag">Three outcomes, not two</span><strong>CLEAN</strong> means the control was tested and held.
      <strong>EXCEPTION</strong> means it was tested and did not. <strong>DISCLAIMER</strong> means there was not
      enough evidence to conclude — and it is never rolled up as a pass. A procedure that can only produce good
      news is marketing, so refusing to conclude is a first-class result.</p>
      <p><strong>A correction we made to ourselves.</strong> C3 originally asserted that
      <code>availableFunds + escrowedFunds ≤ totalAvailable</code> across two contracts, and reported a
      400&nbsp;UBA <em>exception against Flare</em>. Those figures were never defined to relate: escrow reconciles
      exactly against <code>total − immediatelyAvailable</code>, and the 400 UBA is a fee the asset manager nets
      off. The control now tests only the identity that actually holds, and the wedge is <em>disclosed</em> as
      C4 rather than judged. A false accusation is far more damaging to an assurance register than a missed
      finding.</p>
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
  </section>`;

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
        ".ex{color:var(--v-bad)}.dis{color:var(--v-unknown)}.obs{color:var(--faint)}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();

