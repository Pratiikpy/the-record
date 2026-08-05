/**
 * Render the errata page.
 *
 * Given its own permanent URL rather than a footnote on another page, because
 * a corrections record that lives inside the thing it corrects is not a
 * corrections record.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc } from "./index.js";
import { hrefFromIndex, labelOf, REGISTERS } from "./nav.js";
import { ERRATA, summariseErrata, type Erratum } from "./errata.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUTDIR = join(ROOT, "site");
const OUT = join(OUTDIR, "errata.html");

const DISCOVERY_LABEL: Record<Erratum["discovery"], string> = {
  OWN_MACHINERY: "our own machinery",
  WRITTEN_TEST: "a test written for it",
  REVIEW: "re-reading the evidence",
  EXTERNAL: "someone outside the project",
};

const FATE_LABEL: Record<Erratum["fate"], string> = {
  PUBLISHED: "PUBLISHED, THEN WITHDRAWN",
  CAUGHT_BEFORE_PUBLICATION: "CAUGHT BEFORE PUBLICATION",
};

function entry(e: Erratum): string {
  const published = e.fate === "PUBLISHED";
  return `<article class="erratum">
    <div class="erratum-head">
      <h3>${esc(e.id)}</h3>
      <span class="fate ${published ? "pub" : "caught"}">${esc(FATE_LABEL[e.fate])}</span>
      <span class="cap">${esc(e.date)}</span>
      <span class="cap disc">found by ${esc(DISCOVERY_LABEL[e.discovery])}</span>
    </div>
    <dl class="err">
      <dt>Claimed</dt><dd><s>${esc(e.claimed)}</s></dd>
      <dt>Actually</dt><dd><strong>${esc(e.truth)}</strong></dd>
      <dt>Mechanism</dt><dd>${esc(e.mechanism)}</dd>
      <dt>Caught by</dt><dd>${esc(e.caughtBy)}</dd>
      <dt>Now prevented by</dt><dd>${esc(e.preventedBy)}</dd>
    </dl>
  </article>`;
}

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });
  const s = summariseErrata();

  const body = `
  <section>
    ${marker("The Record · errata")}
    <h1>Everything we got wrong.</h1>
    <p class="lede">Every register here makes claims about somebody else's system. The only thing that
      makes that defensible is a permanent, specific account of the times we were wrong — kept with the
      same care as the findings, and never quietly edited away.</p>

    <div class="stats">
      ${stat("Errata", String(s.total), "append-only; nothing is deleted")}
      ${stat("Reached the public", String(s.published), "published, then withdrawn")}
      ${stat("Caught first", String(s.caughtBeforePublication), "disclosed anyway, but not the same thing")}
      ${stat("Found by machinery", String(s.byOwnMachinery + s.byWrittenTest), `${s.byOwnMachinery} by a control or fault injection, ${s.byWrittenTest} by a written test`)}
    </div>

    <div class="note">
      <p><span class="tag">Why this page is specific</span>A retraction is the cheapest thing to fake and
      the hardest thing to fake <em>precisely</em>. Every entry below names the exact wrong value, the
      exact mechanism, and the test that now makes it unconstructable. That is checkable.
      &ldquo;We take accuracy seriously&rdquo; is not.</p>
      <p><strong>Two kinds, never blurred.</strong> Errors that reached the public are marked separately
      from errors caught before anyone saw them. We are not owed credit for the ones that never got out.</p>
    </div>
  </section>

  <section>
    <div class="eyebrow">§ 0.2 — The record of corrections</div>
    <h2>Entries, oldest first</h2>
${ERRATA.map(entry).join("\n")}
  </section>

  <section>
    <div class="note">
      <p><span class="tag">The pattern</span>Three of these are the same error wearing different clothes:
      a comparison between two numbers that were never defined to be equal, or that could never disagree.
      That is the failure mode of assurance work, and it is invisible from the inside — every one of them
      produced confident, well-formatted output that happened to be meaningless.</p>
      <p>Only a deliberate fault distinguishes a control that holds from one that cannot fail. That is why
      the red run exists, why it runs in CI, and why V3 on the
      <a class="cite" href="index.html">verifiability scale</a> requires it.</p>
    </div>
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "The Record — errata",
      description:
        "A permanent, append-only record of every claim this project got wrong, how it was caught, and what now prevents it.",
      section: "errata",
      meta: `${s.total} errata · ${s.published} reached the public`,
      nav: REGISTERS.map((r) => ({ label: labelOf(r), href: hrefFromIndex(r) })),
      body,
      extraCss:
        ".erratum{border-top:1px solid var(--rule);padding:22px 0}" +
        ".erratum-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px}" +
        ".erratum-head h3{margin:0;font-family:var(--mono);font-size:13px;letter-spacing:.06em}" +
        ".fate{font-family:var(--mono);font-size:10px;letter-spacing:.07em;padding:2px 7px;border:1px solid var(--rule-strong)}" +
        ".fate.pub{color:var(--v-bad);border-color:var(--v-bad)}" +
        ".fate.caught{color:var(--v-sim);border-style:dashed}" +
        ".disc{color:var(--faint)}" +
        ".err{display:grid;grid-template-columns:minmax(120px,150px) 1fr;gap:8px 18px;margin:0}" +
        ".err dt{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}" +
        ".err dd{margin:0;font-size:14px;line-height:1.65;max-width:62ch}" +
        ".err s{color:var(--faint)}" +
        "@media (max-width:640px){.err{grid-template-columns:1fr;gap:2px 0}.err dd{margin-bottom:10px}}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();
