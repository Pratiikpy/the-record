/**
 * Emit `faults.json` — the catalogue as a portable artifact.
 *
 * Written to the published site rather than kept in source, because a format
 * nobody can fetch is a format nobody adopts. Validated on the way out: if our
 * own catalogue ever stops conforming to the spec we published, this fails
 * rather than shipping a standard we do not meet.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FAULTS, KNOWN_UNCAUGHT } from "./faults.js";
import { validateFaultsFile, formatViolations } from "./spec-validate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "site", "spec");

const file = {
  schema: "therecord.faults/v1" as const,
  subject: "THE RECORD — procedure CV-1",
  reference: "https://github.com/Pratiikpy/the-record/blob/main/SPEC.md",
  faults: FAULTS.map((f) => ({
    id: f.id,
    title: f.title,
    class: f.class,
    proves: f.proves,
    doesNotProve: f.doesNotProve,
    mustFire: f.mustFire,
    mustNotMove: f.mustNotMove,
  })),
  knownUncaught: KNOWN_UNCAUGHT.map((u) => ({ title: u.title, why: u.why })),
};

const violations = validateFaultsFile(file);
if (violations.length > 0) {
  process.stderr.write(`${formatViolations(violations)}\n`);
  process.stderr.write("refusing to publish a faults.json that violates our own spec\n");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "faults.json"), `${JSON.stringify(file, null, 2)}\n`, "utf8");
process.stderr.write(`  ${file.faults.length} faults · ${file.knownUncaught.length} known uncaught · valid\n`);
process.stderr.write(`→ ${join(OUT, "faults.json")}\n`);
