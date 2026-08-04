/**
 * Produce an execution plan for every unresolved obligation.
 *
 * Nothing is sent. Every plan is complete — the exact attestation request, the
 * target round, the claim function — and every one states what is blocking it.
 * The path works the moment a funded key exists, which is the only honest form
 * of "done" for something that needs money we do not have.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { plan, type Obligation, type Blocker } from "./executor.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "redemptions.json");
const OUT = join(HERE, "..", "out", "claims.json");

const log = (m: string): void => void process.stderr.write(`${m}\n`);

const d = JSON.parse(readFileSync(IN, "utf8")) as { openRedemptions: Obligation[] };
const now = Math.floor(Date.now() / 1000);
const hasFundedKey = process.env.PRIVATE_KEY !== undefined;

/**
 * Plans are built from the perspective of whichever executor was actually
 * named, so the report answers "could a guardian have acted" rather than
 * "could WE act", which nobody can from a machine with no key.
 */
const plans = d.openRedemptions.map((o) =>
  plan(o, now, { ourAddress: o.executor, hasFundedKey }),
);

const count = (b: Blocker): number => plans.filter((p) => p.blocker === b).length;

const out = {
  generatedAt: new Date(now * 1000).toISOString(),
  hasFundedKey,
  note: hasFundedKey
    ? "A funded key is present; these plans are executable."
    : "No funded key. Every plan below is complete and unsent — supply PRIVATE_KEY and the same code executes them.",
  totals: {
    planned: plans.length,
    readyToExecute: count("NONE"),
    blockedOnFunding: count("NO_FUNDED_KEY"),
    notOurRole: count("NOT_OUR_ROLE"),
    notYetDue: count("NOT_YET_DUE"),
    windowClosed: count("PROOF_WINDOW_CLOSED"),
  },
  plans: plans.slice(0, 50).map((p) => ({
    ...p,
    requestBody: Object.fromEntries(
      Object.entries(p.requestBody).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
    ),
  })),
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");

log(`\n─── execution plans at ${out.generatedAt} ───`);
log(`  planned              ${out.totals.planned}`);
log(`  ready to execute     ${out.totals.readyToExecute}`);
log(`  blocked on funding   ${out.totals.blockedOnFunding}`);
log(`  not our role         ${out.totals.notOurRole}`);
log(`  not yet due          ${out.totals.notYetDue}`);
log(`  proof window closed  ${out.totals.windowClosed}`);
log(`\n  ${out.note}`);

const sample = plans.find((p) => p.blocker === "NO_FUNDED_KEY" || p.blocker === "NONE");
if (sample) {
  log(`\n  sample request for #${sample.requestId}:`);
  log(`    attestationType  ${sample.attestationType}`);
  log(`    sourceId         ${sample.sourceId}`);
  log(`    destAddressHash  ${sample.requestBody.destinationAddressHash}`);
  log(`    amount           ${sample.requestBody.amount} UBA`);
  log(`    blocks           ${sample.requestBody.minimalBlockNumber}–${sample.requestBody.deadlineBlockNumber}`);
  log(`    targetRound      ${sample.targetRoundId}`);
  log(`    abiEncoded       ${sample.abiEncodedRequest.slice(0, 66)}… (${(sample.abiEncodedRequest.length - 2) / 2} bytes)`);
}
log(`→ ${OUT}`);
