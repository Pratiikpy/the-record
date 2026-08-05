/**
 * Fail the publish if the snapshot no longer describes the registry.
 *
 * Written after the site served "223 machines" for twenty-nine hours while the
 * chain held 250 — a headline figure 12% wrong, under a badge that reported
 * itself fresh because nothing had ever compared the snapshot to the world.
 * Age is not staleness.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkDrift, driftIsPublishable } from "./drift.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN = join(HERE, "..", "out", "scan.json");
const log = (m: string): void => void process.stderr.write(`${m}\n`);

const scan = JSON.parse(readFileSync(SCAN, "utf8")) as { totalActiveMachines: number };
const r = await checkDrift(scan.totalActiveMachines);

log(`  ${r.state.padEnd(8)} snapshot ${r.snapshotTotal} · live ${r.liveTotal ?? "?"}`);
log(`  ${r.because}`);

if (!driftIsPublishable(r)) {
  log("");
  log("refusing to publish: re-run `pnpm --filter @therecord/reprod scan` first");
  process.exit(1);
}
