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
 * ⚠ THIS REPORTED "84 READY TO EXECUTE" AND IT WAS WRONG.
 *
 * It used to pass `ourAddress: o.executor` — planning from the perspective of
 * whichever executor happened to be named. That answers "could a guardian have
 * acted", which is a fine question, but it makes every row trivially "ours" and
 * reads as though WE could send them.
 *
 * We cannot. All 84 name executor 0x103b3840…f437; ten name none at all. We are
 * the executor on zero, the redeemer on zero, and the agent on zero, so
 * `redemptionPaymentDefault` would revert for every one of them. Acting on that
 * report would have burned 84 transactions to prove nothing.
 *
 * The report now answers BOTH questions and keeps them apart.
 */
const OUR_ADDRESS = process.env.EXECUTOR_ADDRESS as `0x${string}` | undefined;

/** What we, specifically, may submit. */
const plans = d.openRedemptions.map((o) =>
  plan(o, now, { ...(OUR_ADDRESS ? { ourAddress: OUR_ADDRESS } : {}), hasFundedKey }),
);

/** What the appointed guardian could submit — the market-size question. */
const guardianPlans = d.openRedemptions.map((o) =>
  plan(o, now, { ourAddress: o.executor, hasFundedKey: true }),
);

const count = (b: Blocker): number => plans.filter((p) => p.blocker === b).length;

const guardianReady = guardianPlans.filter((p) => p.blocker === "NONE").length;

const out = {
  generatedAt: new Date(now * 1000).toISOString(),
  ourAddress: OUR_ADDRESS ?? null,
  hasFundedKey,
  note:
    count("NONE") === 0 && guardianReady > 0
      ? `We may submit none of these — the appointed executor may submit ${guardianReady}. Requesting the attestation is permissionless, so the proof can still be produced and handed to whoever may claim.`
      : hasFundedKey
        ? "A funded key is present; these plans are executable by us."
        : "No funded key. Every plan below is complete and unsent.",
  totals: {
    planned: plans.length,
    /** what WE may submit — the honest number */
    readyForUsToExecute: count("NONE"),
    /** what the appointed guardian may submit — the market-size number */
    resolvableByAppointedExecutor: guardianReady,
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
log(`  our address                     ${out.ourAddress ?? "(unset)"}`);
log(`  planned                         ${out.totals.planned}`);
log(`  WE may submit                   ${out.totals.readyForUsToExecute}`);
log(`  the appointed executor may      ${out.totals.resolvableByAppointedExecutor}`);
log(`  not our role                    ${out.totals.notOurRole}`);
log(`  blocked on funding              ${out.totals.blockedOnFunding}`);
log(`  not yet due                     ${out.totals.notYetDue}`);
log(`  proof window closed             ${out.totals.windowClosed}`);
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
