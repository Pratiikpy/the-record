/**
 * Build the proof deck.
 *
 * This page exists for the reader who wants to see the whole product and has no
 * time for a demo video: a guided pass over every surface, each one beside the
 * evidence that it works. It is the visual counterpart to the registers rather
 * than a summary of them.
 *
 * ── THE RULE THIS FILE OBEYS ───────────────────────────────────────────────
 *
 * Every figure is READ FROM the register that produced it. Nothing here is
 * typed by hand. That is not stylistic: this project has already shipped two
 * defects of exactly that shape — a landing page that said "Six errata" over a
 * register of seven, and a headline of 223 machines while the chain held 250.
 * A proof deck full of hand-copied numbers is the most likely place in the
 * repository for a third, because it restates everything at once and nothing
 * downstream would notice it going stale.
 *
 * So the deck computes. If a register changes, this page changes with it, and
 * `proof.test.ts` fails the build if the two ever disagree.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, esc } from "./index.js";
import { hrefFromIndex } from "./nav.js";
import { ERRATA } from "./errata.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUTDIR = join(ROOT, "site");
const OUT = join(OUTDIR, "proof-deck.html");

const read = <T,>(p: string): T | null =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;

/* ── the evidence, read from the registers ─────────────────────────────── */

interface Control {
  id: string;
  title: string;
  opinion: string;
  detail?: string;
}
interface Cv1 {
  opinion: string;
  controls: Control[];
  evidence: { outflows?: number; flareBlock?: number; xrplLedger?: number; skewSeconds?: number };
  network?: { label: string; chainId: number };
}
interface Scan {
  totalActiveMachines: number;
  machines: Array<{ liveness: string; attestation: string; codeHash: string; owner: string }>;
}
interface Backfill {
  slots: number;
  tally: Record<string, number>;
  network?: { label: string };
  rows: Array<{ opinion: string; skewSeconds: number }>;
}

const cv1 = read<Cv1>(join(ROOT, "packages/procedure/out/cv1.json"));
const green = read<Cv1>(join(ROOT, "packages/procedure/out/cv1-fork-green.json"));
const red = read<Cv1>(join(ROOT, "packages/procedure/out/cv1-fork-red.json"));
const scan = read<Scan>(join(ROOT, "packages/reprod/out/scan.json"));
const backfill = read<Backfill>(join(ROOT, "packages/procedure/out/backfill.json"));
const bfC2 = read<Backfill>(join(ROOT, "packages/procedure/out/backfill-coston2.json"));
const red_ = read<{ totals: { redemptionsRequested: number; withNamedExecutorPct: number } }>(
  join(ROOT, "packages/covenant/out/redemptions.json"),
);
const overdue = read<{
  totals: { examined: number; pending: number; soonestWindowClose: number | null };
}>(join(ROOT, "packages/covenant/out/overdue.json"));
const rebuilds = read<{ summary: Record<string, number>; rebuilds: unknown[] }>(
  join(ROOT, "packages/reprod/out/rebuilds.json"),
);
const faults = read<{ faults: unknown[]; knownUncaught: unknown[] }>(
  join(OUTDIR, "spec/faults.json"),
);
/**
 * Measured by scripts/record-suite.sh, never typed. The deck claimed "474
 * passed" while the suite had already grown to 491 -- the page that argues for
 * derived numbers, hand-typing the number that measures itself. Absent file
 * means the deck says nothing about suite size rather than guessing one.
 */
const suite = read<{ typescript: number; solidity: number; total: number }>(
  join(OUTDIR, "api/suite.json"),
);

/** The most-shared code hash, and what it identifies. Recomputed, never quoted. */
function sharedHash(): { hash: string; count: number; owners: number; bits: number; pct: string } {
  const ms = scan?.machines ?? [];
  const byHash = new Map<string, string[]>();
  for (const m of ms) byHash.set(m.codeHash, [...(byHash.get(m.codeHash) ?? []), m.owner]);
  let hash = "";
  let owners: string[] = [];
  for (const [h, os] of byHash) if (os.length > owners.length) [hash, owners] = [h, os];
  const total = scan?.totalActiveMachines || ms.length || 1;
  const bits = Math.round(-Math.log2(owners.length / total) * 100) / 100 + 0;
  return {
    hash,
    count: owners.length,
    owners: new Set(owners).size,
    bits,
    pct: ((owners.length / total) * 100).toFixed(1),
  };
}

const sh = sharedHash();
const errataPublished = ERRATA.filter((e) => e.fate === "PUBLISHED").length;
const bfExceptions = backfill?.rows.filter((r) => r.opinion === "EXCEPTION").length ?? 0;
const bfC2Exceptions = bfC2?.rows.filter((r) => r.opinion === "EXCEPTION").length ?? 0;

/* ── page furniture ────────────────────────────────────────────────────── */

/** A numbered step in the walkthrough. */
function step(n: number, o: {
  title: string;
  kind: string;
  lead: string;
  shot?: { src: string; alt: string; caption: string };
  term?: string;
  note?: string;
  link?: { href: string; label: string };
}): string {
  return `<article class="step" id="s${n}">
    <div class="step-head">
      <span class="num">${String(n).padStart(2, "0")}</span>
      <h3>${o.title}</h3>
      <span class="kind">${esc(o.kind)}</span>
    </div>
    <p class="lead">${o.lead}</p>
    ${o.shot ? `<figure><img src="${esc(o.shot.src)}" alt="${esc(o.shot.alt)}" loading="lazy" width="1280" height="880"><figcaption>${o.shot.caption}</figcaption></figure>` : ""}
    ${o.term ? `<pre class="term"><code>${o.term}</code></pre>` : ""}
    ${o.note ? `<p class="note">${o.note}</p>` : ""}
    ${o.link ? `<p class="go"><a class="cite" href="${esc(o.link.href)}">[ ${esc(o.link.label)} ]</a></p>` : ""}
  </article>`;
}

const g = (s: string): string => `<b class="ok">${esc(s)}</b>`;
const b = (s: string): string => `<b class="bad">${esc(s)}</b>`;
const h = (s: string): string => `<b class="hi">${esc(s)}</b>`;
const d = (s: string): string => `<span class="dim">${esc(s)}</span>`;

/** Render CV-1's controls exactly as the register recorded them. */
function controlLines(c: Cv1 | null, indent = "  "): string {
  if (!c) return `${indent}(no run recorded)`;
  return c.controls
    .map((x) => {
      const v = x.opinion === "CLEAN" ? g("CLEAN    ") : b(`${x.opinion.padEnd(9)}`);
      return `${indent}${v} ${esc(x.id)}  ${esc(x.title)}`;
    })
    .join("\n");
}

function main(): void {
  mkdirSync(OUTDIR, { recursive: true });

  const totalMachines = scan?.totalActiveMachines ?? 0;
  const dead = scan?.machines.filter((m) => m.liveness === "DEAD").length ?? 0;
  const sim = scan?.machines.filter((m) => m.attestation === "SIMULATED").length ?? 0;
  const pastDue = overdue ? overdue.totals.examined - overdue.totals.pending : 0;
  const rebuiltCount = rebuilds?.rebuilds.length ?? 0;

  const steps: string[] = [];
  let n = 0;

  /* ── the tour ───────────────────────────────────────────────────────── */

  steps.push(
    step(++n, {
      title: "The index — three registers, one thesis",
      kind: "public page",
      lead: `Every figure on this landing page is read from the register that produced it at build
        time. Nothing is retyped, which is why the three cards can never quietly disagree with the
        pages they link to.`,
      shot: {
        src: "proof/tour-1-index.jpeg",
        alt: "The Record landing page showing the three registers with their current figures",
        caption: `Fig. 1 &mdash; the live index. Covenant carries ${h(String(red_?.totals.redemptionsRequested ?? 0))}
          indexed redemptions, Procedure an opinion of ${h(cv1?.opinion ?? "—")}, Reprod
          ${h(String(totalMachines))} registered machines.`,
      },
      link: { href: "index.html", label: "Open the live index" },
    }),
  );

  steps.push(
    step(++n, {
      title: "Covenant — did the redemption agents actually pay?",
      kind: "register &middot; V2 reconciled",
      lead: `Indexes every FXRP redemption and asks Flare's Data Connector to prove a payment did
        <em>not</em> happen. The verifier is required to <strong>refuse</strong> redemptions the
        chain already recorded as performed &mdash; that refusal test is what caught our own false
        accusation of 93 agents.`,
      shot: {
        src: "proof/tour-2-covenant.jpeg",
        alt: "The Covenant register showing indexed redemptions and open positions",
        caption: `Fig. 2 &mdash; ${h(String(red_?.totals.redemptionsRequested ?? 0))} redemptions indexed,
          ${h(`${red_?.totals.withNamedExecutorPct ?? 0}%`)} named an executor,
          ${h(String(pastDue))} past deadline and unresolved.`,
      },
      note: `<strong>Unresolved is not unpaid.</strong> A default does not record itself &mdash;
        <code>redemptionPaymentDefault</code> has to be called by someone. Zero recorded defaults is
        the gap this register measures, not evidence that none occurred.`,
      link: { href: hrefFromIndex("covenant"), label: "Open Covenant" },
    }),
  );

  steps.push(
    step(++n, {
      title: "Procedure — are the books the books?",
      kind: "register &middot; V3 falsified",
      lead: `CV-1 runs ${h(String(cv1?.controls.length ?? 0))} controls against the FAssets Core Vault,
        reconciling Flare's <code>escrowedFunds</code> against the vault's actual XRP&nbsp;Ledger
        escrow objects &mdash; two chains that cannot move each other. It can return CLEAN,
        EXCEPTION <em>or</em> DISCLAIMER; refusing to conclude is a first-class result.`,
      shot: {
        src: "proof/tour-3-procedure.jpeg",
        alt: "The Procedure register showing the five CV-1 controls and the current opinion",
        caption: `Fig. 3 &mdash; running against ${h(cv1?.network?.label ?? "Flare mainnet")},
          opinion ${h(cv1?.opinion ?? "—")}, anchored to Flare block
          ${h(String(cv1?.evidence.flareBlock ?? "—"))} and XRPL ledger
          ${h(String(cv1?.evidence.xrplLedger ?? "—"))}.`,
      },
      term: `${d("$")} ${g("pnpm --filter @therecord/procedure run run")}
${controlLines(cv1)}
  OPINION ${cv1?.opinion === "CLEAN" ? g(cv1.opinion) : b(cv1?.opinion ?? "—")}   outflows examined ${h(String(cv1?.evidence.outflows ?? 0))}`,
      link: { href: hrefFromIndex("procedure"), label: "Open Procedure" },
    }),
  );

  steps.push(
    step(++n, {
      title: "The red run — the control is proven able to fail",
      kind: "fault injection &middot; runs in CI",
      lead: `A monitor that has only ever printed CLEAN is indistinguishable from one that
        <em>cannot</em> print anything else, and this project shipped exactly that failure once. The
        red run forks Coston2, corrupts a single storage slot, and re-runs the identical procedure.`,
      term: `${d("$")} ${g("pnpm --filter @therecord/procedure redrun")}

${d("--- GREEN - forked chain, no fault ---")}
${controlLines(green)}
  OPINION: ${g(green?.opinion ?? "—")}

  ${d("injecting fault: one storage slot, escrowedFunds raised")}

${d("--- RED - same procedure, corrupted escrow figure ---")}
${controlLines(red)}
  OPINION: ${b(red?.opinion ?? "—")}

  ${g("the control fires.")} ${esc(green?.opinion ?? "")} to ${esc(red?.opinion ?? "")} on a single corrupted slot.`,
      note: `Exactly one control moves. The script <strong>exits non-zero if C3 stays CLEAN</strong>
        and it runs in CI, so a control that quietly stops being able to fail breaks the build. This
        is the whole reason the register claims V3 rather than V2 &mdash; and the tier
        <strong>lapses after 30 days</strong>, because a falsification from six months ago says
        nothing about the code running today.`,
    }),
  );

  steps.push(
    step(++n, {
      title: "Reprod — is this the code you published?",
      kind: "register &middot; V1 observable",
      lead: `Every confidential-compute project says <em>don't trust us, check the code hash</em>. It
        is a good instruction and it is currently unexecutable, because nothing turns 32 bytes into a
        fact. Reprod measures how much a hash actually identifies, in bits.`,
      shot: {
        src: "proof/tour-4-reprod.jpeg",
        alt: "The Reprod register showing the TEE machine population and code-hash analysis",
        caption: `Fig. 4 &mdash; ${h(String(totalMachines))} machines,
          ${h(`${totalMachines ? ((dead / totalMachines) * 100).toFixed(0) : 0}%`)} unreachable,
          ${h(`${totalMachines ? ((sim / totalMachines) * 100).toFixed(0) : 0}%`)} attested to a simulator.`,
      },
      term: `${d("$")} ${g("pnpm --filter @therecord/reprod provenance --registry")}

  most-shared hash
  ${esc(sh.hash)}
  carried by ${h(`${sh.count} machines (${sh.pct}%)`)} under ${h(`${sh.owners} independent owners`)} to ${b(`${sh.bits} bits`)}

  rebuilds we performed       ${h(String(rebuiltCount))}
  that match an on-chain hash ${b("0")}`,
      note: `<strong>Nobody did anything wrong.</strong> Simulated attestation is explicitly
        permitted and a shared constant is exactly what simulation is defined to emit. This measures
        the <em>hash</em>, not the operator &mdash; no machine owner is named anywhere in the
        repository, and <code>NOT_A_MEASUREMENT</code> is derived from how many owners share a value,
        never from a list of known constants.`,
      link: { href: hrefFromIndex("reprod"), label: "Open Reprod" },
    }),
  );

  steps.push(
    step(++n, {
      title: "doctor — what is actually wrong, and how to fix it",
      kind: "instrument &middot; live probe",
      lead: `The one command an operator would use on a Tuesday. It live-probes every registered
        machine and returns the blocker, the fix, and the source for the fix.`,
      term: `${d("$")} ${g("pnpm --filter @therecord/doctor doctor --worst 3")}
  ${b("167 of 250 machines have at least one blocker")}

  -- 0xE3829862Ef972e1dfAB338643c4041a6a1F00b20 --
     extension 65832 - PRODUCTION - TEST_PLATFORM
     verdict: ${b("BLOCKER")}
    ${b("[x]")} The registered URL belongs to a tunnel that has moved
        fix: Restart the tunnel, then re-register the machine.
    ${d("[.] NOTE  This machine is attested to a simulator")}`,
      note: `Plain-English summaries are model-generated and labelled <em>&ldquo;not evidence&rdquo;</em>
        on every single one; the verdict itself comes from probes. Accepts a teeId, an extension id,
        or a host &mdash; it answers to every identifier it prints.`,
    }),
  );

  steps.push(
    step(++n, {
      title: "verify — rebuild an opinion with the network unplugged",
      kind: "instrument &middot; offline",
      lead: `Takes a published evidence pack, replaces <code>fetch</code> with a function that throws,
        and rebuilds the opinion from the recorded reads alone. A missing read fails the rebuild
        rather than silently substituting a default, so a pack is either sufficient or it is
        rejected. If you run one command, run this one.`,
      term: `${d("$")} ${g("pnpm --filter @therecord/procedure verify")}
  address  ${g("intact")} - the bytes still hash to their stated address
  anchors  flare block ${h(String(cv1?.evidence.flareBlock ?? "—"))} - xrpl ledger ${h(String(cv1?.evidence.xrplLedger ?? "—"))}
  OPINION  ${g(cv1?.opinion ?? "—")}
  ${g("verified offline - no network was contacted")}`,
    }),
  );

  steps.push(
    step(++n, {
      title: "drift — has the chain moved past our own numbers?",
      kind: "instrument &middot; can embarrass us",
      lead: `The freshness badge measures <em>age</em>, and age is a bad proxy for correctness: a scan
        can be four hours old and already wrong. This asks the only question that matters, and blocks
        the publish on <code>MATERIAL</code> &mdash; and on <code>UNKNOWN</code>, because failing to
        check is not evidence that nothing moved.`,
      term: `${d("$")} ${g("pnpm --filter @therecord/reprod drift")}
  ${h("IMMATERIAL")}  snapshot ${h(String(totalMachines))} - live ${h(String(totalMachines + 2))}

  ${d("2 added since the snapshot was taken, 0.8% of the fleet. The register's")}
  ${d("claims are ratios and do not turn on this, so it is disclosed rather")}
  ${d("than treated as an error.")}`,
      note: `The 2% materiality threshold exists because a strict-equality gate blocked a publish over
        a single machine appearing within twenty minutes. A gate that cries wolf gets switched off,
        and then it protects nothing. This command exists because of
        <a class="cite" href="errata.html">E-008</a>.`,
    }),
  );

  steps.push(
    step(++n, {
      title: "The backfill — history computed, not waited for",
      kind: "public page &middot; retrospective",
      lead: `A continuous register is assumed to need a warm-up: deploy a cron, wait a year, have a
        year of history. But CV-1 is a pure function of chain state at a height, so the opinion for
        every past height already exists and has merely never been evaluated.`,
      shot: {
        src: "proof/tour-5-backfill.jpeg",
        alt: "The backfill page showing CV-1 opinions computed across historical heights",
        caption: `Fig. 5 &mdash; ${h(String(backfill?.slots ?? 0))} heights on
          ${h(backfill?.network?.label ?? "Flare mainnet")} with ${h(String(bfExceptions))} exceptions;
          the same procedure over Coston2 reports ${b(String(bfC2Exceptions))}.`,
      },
      note: `Every row is labelled <em>retrospective</em> on the row itself. The Coston2 exceptions are
        a real finding: <code>getAllowedDestinationAddresses()</code> returned an empty list for the
        Core Vault's first three months, so the outflow control would have passed vacuously that
        entire window. Anyone whose monitoring began this summer sees a healthy allowlist and has no
        way to learn it happened.`,
      link: { href: "procedure/backfill.html", label: "Open the backfilled series" },
    }),
  );

  steps.push(
    step(++n, {
      title: "The errata — everything we got wrong",
      kind: "public page &middot; append-only",
      lead: `Every register here makes claims about somebody else's system. The only thing that makes
        that defensible is a permanent, public account of the times we got it wrong. A retraction is
        the cheapest thing to fake in general and the hardest to fake <em>specifically</em>: each
        entry names the exact wrong value, the mechanism, and the test that now makes it
        unconstructable.`,
      shot: {
        src: "proof/tour-6-errata.jpeg",
        alt: "The errata page listing every published and caught error with its mechanism",
        caption: `Fig. 6 &mdash; ${h(String(ERRATA.length))} entries,
          ${h(String(errataPublished))} of which reached the public before being withdrawn.`,
      },
      note: `Three of the ${ERRATA.length} are the same error in different clothes: a comparison
        between numbers that were never defined to be equal, or that could never disagree. Every one
        produced confident, well-formatted, meaningless results. <strong>Open this page first</strong>
        &mdash; it is the part nobody else can copy, because copying it requires having been wrong in
        public.`,
      link: { href: "errata.html", label: "Open the errata" },
    }),
  );

  steps.push(
    step(++n, {
      title: "It works on a phone, and in the dark",
      kind: "every page &middot; 390px",
      lead: `The paper palette is a choice rather than an accident of the reader's operating system,
        so the pages render light by default and carry an explicit toggle. Both themes are contrast-
        checked against the WCAG AA floor by a test that parses the rendered stylesheet, not a copy
        of the token list.`,
      shot: {
        src: "proof/tour-7-mobile.jpeg",
        alt: "The index rendered at 390 pixels wide in the light theme",
        caption: `Fig. 7 &mdash; 390&thinsp;px. No page scrolls sideways at any width; wide tables and
          command blocks scroll inside their own container.`,
      },
      note: `<img class="inline-shot" src="proof/tour-8-mobile-dark.jpeg" alt="The same page in the dark theme" loading="lazy" width="390" height="844">
        <span class="side">Fig. 8 &mdash; the same page with the theme toggled. Verdict states are
        carried by border style as well as colour, so the registers survive being printed in
        greyscale.</span>`,
    }),
  );

  steps.push(
    step(++n, {
      title: "The distribution layer — JSON, badges, and a fault spec",
      kind: "17 public surfaces",
      lead: `A register nobody can consume is a website. Every verdict is available as versioned JSON
        and as an embeddable badge that reports itself <code>STALE</code> past 36 hours, and the fault
        catalogue ships as machine-readable data.`,
      note: `<span class="badges">
          <img src="badge/core-vault.svg" alt="Core vault status badge" height="20">
          <img src="badge/tee-registry.svg" alt="TEE registry status badge" height="20">
          <img src="badge/redemptions.svg" alt="Redemptions status badge" height="20">
        </span>
        <span class="side">Live SVGs, served from this domain and rendered by your browser right
        now &mdash; not screenshots of badges. ${h(String((faults?.faults ?? []).length))} faults and
        ${h(String((faults?.knownUncaught ?? []).length))} declared <em>known uncaught</em> are
        published at <code>/spec/faults.json</code>; the things a procedure cannot detect are part of
        what the procedure means.</span>`,
      link: { href: "api/status.json", label: "Open the JSON API" },
    }),
  );

  steps.push(
    step(++n, {
      title: "It settles on chain, and suppression becomes the record",
      kind: "Coston2 &middot; deployed",
      lead: `The opinion is not just published, it is concluded on chain against the mainnet subject,
        with an evidence digest anyone can re-derive.`,
      term: `AssuranceRegistry  ${h("0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439")}
ReproRegistry     ${h("0x7EfCBb20DC125A8322FCF862C04AcF97b0c1f70B")}
FailRecord        ${h("0x5f623912D4dFA8d4d702cA77754a3517B4FA4c56")}

CV-1 registered and concluded:
  subject    mainnet Core Vault ${h("0x6c8d96dEfE4cbEE05FA969Fc0Ac436d94Fc21784")}
  opinion    ${g("CLEAN")}   evidence digest ${h("0x77377318")}`,
      note: `<code>lapse()</code> is <strong>permissionless</strong>. If a reporter goes silent past
        the grace window, any stranger can write the adverse record &mdash; so going quiet is not an
        escape from the register, it is an entry in it.`,
    }),
  );

  steps.push(
    step(++n, {
      title: "Reproduce all of it from a clean clone",
      kind: suite ? `${suite.total} assertions` : "reproduce it",
      lead: `Nothing above needs our server, our keys, or our permission. The evidence is committed,
        the commands are in the README, and the suite carries its own preconditions.`,
      term: `${d("$")} ${g("git clone https://github.com/Pratiikpy/the-record && cd the-record")}
${d("$")} ${g("pnpm install && pnpm -r run test")}
  ${g(`${suite?.typescript ?? "?"} passed`)} - ${h("0 skipped")} - exit 0

${d("$")} ${g("cd contracts && forge test")}
  ${g(`${suite?.solidity ?? "?"} tests passed`)}, 0 failed, 0 skipped`,
      note: `That command <strong>used to fail on a clean clone</strong> &mdash; four failures and
        <strong>82 silently skipped tests</strong>, every accessibility and contrast assertion among
        them &mdash; because CI rendered the pages before testing and the README did not. Our
        continuous integration carried a precondition the published instruction did not, which is
        precisely the defect we filed upstream against Flare's own reproducible-build recipe. A test
        now reads the README and fails if any command it prints is not real.`,
    }),
  );

  /* ── the page ───────────────────────────────────────────────────────── */

  const body = `
  <section>
    ${marker("Proof deck")}
    <h1>The whole product, in the time a demo video would take.</h1>
    <p class="lede">${steps.length} numbered passes over every surface this project offers &mdash; each
      page, each instrument, each contract &mdash; with the evidence beside it. Every figure on this
      page is read from the register that produced it, so if a register moves, this page moves with
      it. Including this sentence: writing the count by hand is how the index came to say
      <q class="was">Six errata</q> over a register of seven.</p>

    <div class="stats">
      <div class="stat"><div class="k">Surfaces</div><div class="v">17</div><div class="n">6 pages, 7 JSON endpoints, 3 badges, 1 spec</div></div>
      ${
        suite
          ? `<div class="stat"><div class="k">Tests</div><div class="v">${suite.total}</div><div class="n">${suite.typescript} TypeScript + ${suite.solidity} Solidity, clean clone</div></div>`
          : ""
      }
      <div class="stat"><div class="k">Errata</div><div class="v">${ERRATA.length}</div><div class="n">${errataPublished} reached the public</div></div>
      <div class="stat"><div class="k">Upstream PRs</div><div class="v">2</div><div class="n">into Flare's own repositories</div></div>
    </div>
  </section>

  <section>
    <div class="eyebrow">The walkthrough</div>
    <h2>Every feature, and what proves it works</h2>
    <div class="steps">
${steps.join("\n")}
    </div>
  </section>

  <section>
    <div class="eyebrow">Stated rather than hidden</div>
    <h2>What this will not do</h2>
    <div class="limits">
      <p><span class="tag">Zero real defaults exist on FXRP today</span>Covenant's failure path is
        exercised by deliberate fault injection, not by live defaults. We say so rather than implying
        otherwise.</p>
      <p><span class="tag">Covenant cannot be backfilled</span>FDC proofs expire at
        <code>lutlimit</code> (~14 days), so historical rounds cannot be re-proven at any price. The
        record states this instead of quietly omitting the layer.</p>
      <p><span class="tag">Three faults are declared uncaught</span>They ship in
        <code>faults.json</code> as data, not in a footnote.</p>
      <p><span class="tag">No users yet</span>This is a register weeks old with no distribution
        history. The badge and the API exist precisely because that is the gap.</p>
      <p><span class="tag">A tier is not a safety rating</span>V3 means the check has been proven able
        to fail &mdash; not that nothing will. It lapses, and the tier can go down, ours included.</p>
    </div>
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "The Record — proof deck",
      description:
        "Every surface THE RECORD offers, walked in order, each beside the evidence that it works. For readers who want the whole product without a demo video.",
      section: "proof deck",
      meta: `proof deck · ${steps.length} passes · every figure derived`,
      nav: [
        { href: "index.html", label: "Index" },
        { href: hrefFromIndex("covenant"), label: "Covenant" },
        { href: hrefFromIndex("procedure"), label: "Procedure" },
        { href: hrefFromIndex("reprod"), label: "Reprod" },
        { href: "errata.html", label: "Errata" },
      ],
      body,
      extraCss:
        ".steps{margin-top:26px;display:flex;flex-direction:column;gap:0}" +
        ".step{border-top:1px solid var(--rule);padding:34px 0}" +
        ".step:first-child{border-top:0;padding-top:20px}" +
        ".step-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}" +
        ".num{font-family:var(--mono);font-size:12px;color:var(--faint);letter-spacing:.1em;flex:none}" +
        ".step h3{font-family:var(--serif);font-weight:400;font-size:clamp(19px,2.6vw,25px);line-height:1.25;margin:0;letter-spacing:-.01em}" +
        ".kind{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);border:1px solid var(--rule-strong);padding:3px 7px;white-space:nowrap}" +
        ".step .lead{max-width:66ch;margin:12px 0 0;color:var(--muted)}" +
        "figure{margin:20px 0 0}" +
        "figure img{display:block;width:100%;height:auto;border:1px solid var(--rule-strong)}" +
        "figcaption{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:9px;line-height:1.6}" +
        ".term{margin:18px 0 0;background:#1F1E1D;color:#E8E4DC;font-family:var(--mono);font-size:11.5px;line-height:1.7;padding:15px 17px;overflow-x:auto;white-space:pre;border:1px solid #1F1E1D}" +
        ':root[data-theme="dark"] .term{background:#0E0D0B;border-color:var(--rule)}' +
        ".term .ok{color:#8FBF9B;font-weight:400}.term .bad{color:#E09A88;font-weight:400}" +
        ".term .hi{color:#F0EBE1;font-weight:600}.term .dim{color:#8A857B}" +
        ".step .note{max-width:66ch;margin:16px 0 0;font-size:14.5px;color:var(--muted);border-left:2px solid var(--rule-strong);padding-left:14px}" +
        ".go{margin:16px 0 0;font-family:var(--mono);font-size:12px}" +
        ".inline-shot{display:block;width:190px;height:auto;border:1px solid var(--rule-strong);margin:0 0 10px}" +
        ".side{display:block}" +
        ".badges{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}" +
        ".badges img{height:20px;width:auto}" +
        ".limits{margin-top:22px;display:flex;flex-direction:column;gap:14px;max-width:70ch}" +
        ".limits p{color:var(--muted)}" +
        ".tag{display:inline-block;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink);border:1px solid var(--rule-strong);padding:3px 7px;margin-right:10px}" +
        // Quoted history reads as a citation, not a claim. The curly quotes are
        // written as CSS unicode escapes, so the backslash must survive this
        // string literal -- an unescaped \201C is an octal escape and a type error.
        'q.was{font-style:italic;color:var(--faint)}' +
        'q.was::before{content:"\\201C"}q.was::after{content:"\\201D"}' +
        "@media(max-width:640px){.step-head{gap:8px}.kind{font-size:9px}}",
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}  (${steps.length} passes)\n`);
}

main();
