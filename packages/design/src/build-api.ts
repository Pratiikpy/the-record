/**
 * Emit the distribution surface: badges and a machine-readable API.
 *
 * The registers were only ever a place you visit. Every assurance product that
 * became infrastructure did the opposite — it went to where the reader already
 * was, and it gave other people something to build on. Sourcify's mark,
 * shields.io, L2Beat's stage label, DefiLlama's endpoints.
 *
 * So this writes, from the same evidence the pages are rendered from:
 *
 *   /api/status.json          every subject, one document
 *   /api/<subject>.json       one subject, versioned schema
 *   /badge/<subject>.svg      embeddable anywhere, states its own age
 *
 * Generated from the register JSON rather than re-derived, so the API cannot
 * drift from the page. If they ever disagree, that is the bug this layout is
 * designed to make impossible.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { badge, statusDocument, type BadgeState, type StatusDocument } from "./badge.js";
import { grade, shortGrade, SCALE_DISCLAIMER, type Grade } from "./grade.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const SITE = join(ROOT, "site");

const SITE_URL = process.env.SITE_URL ?? "https://the-record.vercel.app";

interface Subject {
  slug: string;
  label: string;
  /** register JSON to read the verdict from */
  source: string;
  href: string;
  read: (raw: unknown) => { state: BadgeState; generatedAt: string; evidenceDigest?: string } | null;
  /** the verifiability tier, graded from evidence we actually hold */
  gradeOf: (now: Date) => Grade;
}

interface Cv1Shape {
  opinion?: string;
  period?: string;
  generatedAt?: string;
  network?: { label?: string };
  evidence?: { evidenceDigest?: string };
}

interface ScanShape {
  scannedAt?: string;
  machines?: Array<{ codeHash: string; owner: string }>;
  totalActiveMachines?: number;
}

const asState = (s: string | undefined): BadgeState =>
  s === "CLEAN" || s === "EXCEPTION" || s === "DISCLAIMER" ? s : "UNKNOWN";

const SUBJECTS: Subject[] = [
  {
    slug: "core-vault",
    label: "FXRP core vault",
    source: join(ROOT, "packages", "procedure", "out", "cv1.json"),
    href: `${SITE_URL}/procedure/`,
    read: (raw) => {
      const r = raw as Cv1Shape;
      if (!r.opinion) return null;
      return {
        state: asState(r.opinion),
        // The report's own timestamp. `period` is the day under test and is
        // only a fallback -- using it for freshness dated reports into the
        // future and produced negative ages.
        generatedAt: r.generatedAt ?? `${r.period ?? "1970-01-01"}T12:00:00.000Z`,
        evidenceDigest: r.evidence?.evidenceDigest,
      };
    },
    gradeOf: (now) => {
      const red = readJson(join(ROOT, "packages", "procedure", "out", "cv1-fork-red.json")) as
        | { generatedAt?: string; opinion?: string }
        | null;
      // V3 rests on a falsification that actually happened and actually fired.
      // A red run that did not go EXCEPTION is not a falsification.
      const falsified = red?.opinion === "EXCEPTION" ? red.generatedAt : undefined;
      return grade({
        subject: "FXRP core vault",
        publiclyReadable: true,
        publicEvidence:
          "read from Flare's public contract registry and public XRP Ledger servers, with no credentials",
        independentSources: 2,
        independentEvidence: "Flare CoreVaultManager and the XRP Ledger; neither determines what the other reports",
        disagreementDetectable: true,
        disagreementEvidence: "C3 reconciles escrowedFunds against XRPL Escrow objects and reports EXCEPTION on a mismatch",
        lastFalsifiedAt: falsified,
        falsificationEvidence: "storage slot corrupted on a Coston2 fork; C3 went CLEAN to EXCEPTION and four controls held",
        now,
      });
    },
  },
  {
    slug: "tee-registry",
    label: "Flare TEE registry",
    source: join(ROOT, "packages", "reprod", "out", "scan.json"),
    href: `${SITE_URL}/reprod/`,
    read: (raw) => {
      const r = raw as ScanShape;
      if (!r.scannedAt || !r.machines) return null;
      // Not a pass/fail surface: the registry is measured, not judged. What the
      // badge reports is whether ANY machine's code hash can be traced to
      // source. Today that is none of them, and DISCLAIMER is the honest state
      // for "we could not establish it", not EXCEPTION -- nobody did anything
      // wrong.
      return { state: "DISCLAIMER", generatedAt: r.scannedAt };
    },
    gradeOf: (now) => {
      const scan = readJson(join(ROOT, "packages", "reprod", "out", "scan.json")) as
        | { machines?: Array<{ codeHash: string; owner: string }> }
        | null;
      const machines = scan?.machines ?? [];
      // A second source would be a claimed source revision to rebuild against.
      // Today no machine in the registry has one, so there is nothing to
      // reconcile the on-chain hash with -- one source, however public it is.
      const traceable = 0;
      return grade({
        subject: "Flare TEE registry",
        publiclyReadable: machines.length > 0,
        publicEvidence: `all ${machines.length} machines readable from FlareTeeManager without permission`,
        independentSources: traceable > 0 ? 2 : 1,
        independentEvidence:
          "the registry states a code hash; no machine declares a source revision to rebuild against, so nothing cross-checks it",
        disagreementDetectable: false,
        disagreementEvidence: "with one source there is nothing that could disagree",
        now,
      });
    },
  },
  {
    slug: "agent-backing",
    label: "FXRP agent backing",
    source: join(ROOT, "packages", "procedure", "out", "agents.json"),
    href: `${SITE_URL}/procedure/`,
    read: (raw) => {
      const r = raw as { opinion?: string; generatedAt?: string };
      // No timestamp means no freshness, and a badge that invents one is worse
      // than no badge. Refusing to emit is the honest failure here.
      if (!r.opinion || !r.generatedAt) return null;
      return { state: asState(r.opinion), generatedAt: r.generatedAt };
    },
    gradeOf: (now) => {
      const a = readJson(join(ROOT, "packages", "procedure", "out", "agents.json")) as
        | { fleet?: { agents?: number }; bracket?: { readings?: number } }
        | null;
      const agents = a?.fleet?.agents ?? 0;
      const readings = a?.bracket?.readings ?? 0;
      // No V3 claim here yet. AB-1's ability to fire is proven by written tests,
      // not by a fault injected into a forked chain, and the scale says
      // FALSIFIED means a fault was injected and caught. Asserting V3 from unit
      // tests would be the grade inflation this project exists to catch.
      return grade({
        subject: "FXRP agent backing",
        publiclyReadable: agents > 0,
        publicEvidence: `all ${agents} FXRP agents read from Flare's AssetManager and public XRP Ledger servers, no credentials`,
        independentSources: 2,
        independentEvidence:
          "Flare's AssetManager records underlyingBalanceUBA; the XRP Ledger holds the balance. Neither determines what the other reports",
        disagreementDetectable: true,
        disagreementEvidence: `a shortfall surviving all ${readings} readings of the settle bracket is published as EXCEPTION; one that resolves is a DISCLAIMER naming the skew`,
        now,
      });
    },
  },
  {
    slug: "redemptions",
    label: "FXRP redemptions",
    source: join(ROOT, "packages", "covenant", "out", "control.json"),
    href: `${SITE_URL}/covenant/`,
    read: (raw) => {
      const r = raw as { generatedAt?: string; passed?: boolean };
      if (!r.generatedAt) return null;
      // The control tests whether the request builder can distinguish paid
      // from unpaid. A pass is a precondition for any default finding, not a
      // statement that the redemptions are healthy -- so the badge reports
      // DISCLAIMER rather than CLEAN, because zero recorded defaults is a gap
      // in the record and not evidence against one.
      return { state: r.passed === true ? "DISCLAIMER" : "EXCEPTION", generatedAt: r.generatedAt };
    },
    gradeOf: (now) => {
      const ctl = readJson(join(ROOT, "packages", "covenant", "out", "control.json")) as
        | { generatedAt?: string; passed?: boolean; tested?: number }
        | null;
      return grade({
        subject: "FXRP redemptions",
        publiclyReadable: true,
        publicEvidence:
          "redemption requests and completions are public on Flare; the underlying payments are public on the XRP Ledger",
        independentSources: 2,
        independentEvidence:
          "Flare's own redemption record and the XRP Ledger's payment record, the latter reached through the Flare Data Connector; neither determines what the other says",
        disagreementDetectable: ctl?.passed === true,
        disagreementEvidence:
          ctl?.passed === true
            ? `the control offered ${ctl.tested ?? 0} settled redemptions to the verifier and it refused every one, so a paid redemption cannot be attested as unpaid`
            : "the control has not established that a paid redemption would be refused",
        // No dated fault injection for this layer yet. V3 is not claimed, and
        // the next step the grade prints is exactly what would earn it.
        now,
      });
    },
  },
];

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main(): void {
  mkdirSync(join(SITE, "api"), { recursive: true });
  mkdirSync(join(SITE, "badge"), { recursive: true });

  const all: Array<StatusDocument & { grade: { tier: number; name: string; short: string } }> = [];
  const now = new Date();

  for (const s of SUBJECTS) {
    if (!existsSync(s.source)) {
      process.stderr.write(`  skip ${s.slug}: ${s.source} not built\n`);
      continue;
    }
    const parsed = s.read(JSON.parse(readFileSync(s.source, "utf8")));
    if (!parsed) {
      process.stderr.write(`  skip ${s.slug}: source had no verdict\n`);
      continue;
    }

    const input = {
      subject: s.label,
      state: parsed.state,
      generatedAt: parsed.generatedAt,
      now,
      href: s.href,
      ...(parsed.evidenceDigest ? { evidenceDigest: parsed.evidenceDigest } : {}),
    };

    const g = s.gradeOf(now);
    const doc = { ...statusDocument(input), grade: { tier: g.tier, name: g.name, short: shortGrade(g) } };
    all.push(doc);

    writeFileSync(
      join(SITE, "api", `${s.slug}.grade.json`),
      `${JSON.stringify({ schema: "therecord.grade/v1", scaleDisclaimer: SCALE_DISCLAIMER, ...g }, null, 2)}
`,
      "utf8",
    );

    writeFileSync(join(SITE, "api", `${s.slug}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    writeFileSync(join(SITE, "badge", `${s.slug}.svg`), badge(input).svg, "utf8");
    process.stderr.write(`  ${s.slug.padEnd(14)} ${doc.state.padEnd(11)} ${doc.ageHours}h old\n`);
  }

  writeFileSync(
    join(SITE, "api", "status.json"),
    `${JSON.stringify(
      {
        schema: "therecord.status-index/v1",
        generatedAt: now.toISOString(),
        site: SITE_URL,
        scaleDisclaimer: SCALE_DISCLAIMER,
        subjects: all,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  process.stderr.write(`→ ${join(SITE, "api")} · ${join(SITE, "badge")}\n`);
}

main();
