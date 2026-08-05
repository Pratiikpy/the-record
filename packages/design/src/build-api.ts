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
  },
];

function main(): void {
  mkdirSync(join(SITE, "api"), { recursive: true });
  mkdirSync(join(SITE, "badge"), { recursive: true });

  const all: StatusDocument[] = [];
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

    const doc = statusDocument(input);
    all.push(doc);

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
