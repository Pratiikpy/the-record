/**
 * The verifiability scale — V0 to V3.
 *
 * CLEAN / EXCEPTION / DISCLAIMER is a verdict about one period. It answers
 * "what did the check say today". It does not answer the question a reader
 * actually carries around: *how much of this can I check myself?*
 *
 * That question is the one thing this project is uniquely positioned to
 * measure, and it is deliberately NOT a safety rating. Nothing here claims a
 * system is sound, solvent or well-run. A high tier means only that an
 * outsider can establish things about it without permission — and that the
 * means of establishing them has itself been tested.
 *
 *   V0  ASSERTED     the system states facts about itself; you take its word
 *   V1  OBSERVABLE   the facts are public, a stranger can read them
 *   V2  RECONCILED   two independent sources agree, and disagreement would show
 *   V3  FALSIFIED    the check is PROVEN able to fail, on the record, recently
 *
 * ── WHY V3 IS THE TOP, AND WHY IT EXPIRES ──────────────────────────────────
 *
 * A reconciliation you have never seen fail is indistinguishable from one that
 * CANNOT fail. This project shipped exactly that: an identity between two
 * figures derived from the same storage slot, green every period, incapable of
 * being anything else. V2 is where most good monitoring stops, and V2 is where
 * that bug lived comfortably.
 *
 * So V3 requires a fault to have been injected and the control to have caught
 * it — and it LAPSES. A falsification from six months ago says nothing about
 * the code running today. The tier can go down. Ours will, if we stop testing.
 *
 * ── WHAT THE SCALE REFUSES TO DO ───────────────────────────────────────────
 *
 * It never infers a tier from reputation, audit count, team, or TVL. Every
 * criterion below is a predicate over evidence we actually hold, and a
 * criterion that cannot be evaluated counts as NOT met — never as passed.
 */

export type Tier = 0 | 1 | 2 | 3;

export const TIER_NAME: Record<Tier, string> = {
  0: "ASSERTED",
  1: "OBSERVABLE",
  2: "RECONCILED",
  3: "FALSIFIED",
};

export const TIER_MEANING: Record<Tier, string> = {
  0: "The system states facts about itself and nothing independent confirms them.",
  1: "The facts are public, so a stranger can read them without asking permission.",
  2: "Two independent sources are compared, and a disagreement between them would be detected.",
  3: "The comparison has been proven capable of failing — a fault was injected and it fired.",
};

/** How recently a falsification must have run for V3 to hold. */
export const FALSIFICATION_BUDGET_DAYS = 30;

export interface Criterion {
  id: string;
  tier: Tier;
  /** what must be true, in a reader's words */
  requires: string;
  met: boolean;
  /** the evidence, or the reason it could not be established */
  because: string;
}

export interface GradeInput {
  subject: string;
  /** the facts are readable by a third party from public sources */
  publiclyReadable?: boolean;
  publicEvidence?: string;
  /** a second source exists that the first cannot influence */
  independentSources?: number;
  independentEvidence?: string;
  /** a disagreement between the sources would change the verdict */
  disagreementDetectable?: boolean;
  disagreementEvidence?: string;
  /** ISO date a fault was last injected and caught */
  lastFalsifiedAt?: string;
  falsificationEvidence?: string;
  now?: Date;
}

export interface Grade {
  subject: string;
  tier: Tier;
  name: string;
  meaning: string;
  criteria: Criterion[];
  /** the single thing that would raise the tier, if anything can */
  nextStep: string | null;
  /** set when a previously-earned V3 has gone out of date */
  lapsed?: string;
}

const daysSince = (iso: string, now: Date): number =>
  (now.getTime() - Date.parse(iso)) / 86_400_000;

/**
 * Grade a subject from evidence.
 *
 * Tiers are cumulative and strictly ordered: the awarded tier is the highest
 * level whose criteria — and every criterion below it — are met. A gap at V1
 * caps the subject at V0 no matter how sophisticated its V3 story is, because
 * a falsification test over facts nobody can read establishes nothing.
 */
export function grade(input: GradeInput): Grade {
  const now = input.now ?? new Date();
  const criteria: Criterion[] = [];

  criteria.push({
    id: "V1.public",
    tier: 1,
    requires: "The facts can be read from public sources by someone with no relationship to the subject.",
    met: input.publiclyReadable === true,
    because:
      input.publicEvidence ??
      (input.publiclyReadable === true ? "public sources confirmed" : "not established"),
  });

  criteria.push({
    id: "V2.independent",
    tier: 2,
    requires: "At least two sources are read, and neither can determine what the other says.",
    met: (input.independentSources ?? 0) >= 2,
    because:
      input.independentEvidence ??
      `${input.independentSources ?? 0} independent source(s) identified`,
  });

  criteria.push({
    id: "V2.detectable",
    tier: 2,
    requires: "A disagreement between those sources would change the published verdict.",
    met: input.disagreementDetectable === true,
    because: input.disagreementEvidence ?? "not established",
  });

  const falsifiedDays = input.lastFalsifiedAt ? daysSince(input.lastFalsifiedAt, now) : null;
  const falsifiedFresh =
    falsifiedDays !== null && Number.isFinite(falsifiedDays) && falsifiedDays >= 0 && falsifiedDays <= FALSIFICATION_BUDGET_DAYS;

  criteria.push({
    id: "V3.falsified",
    tier: 3,
    requires: `A fault has been deliberately injected and the check caught it, within ${FALSIFICATION_BUDGET_DAYS} days.`,
    met: falsifiedFresh,
    because:
      falsifiedDays === null
        ? "no falsification on record — the check has never been shown able to fail"
        : !Number.isFinite(falsifiedDays) || falsifiedDays < 0
          ? "the falsification date is not a usable timestamp"
          : falsifiedFresh
            ? (input.falsificationEvidence ?? `last falsified ${Math.round(falsifiedDays)}d ago`)
            : `last falsified ${Math.round(falsifiedDays)}d ago, beyond the ${FALSIFICATION_BUDGET_DAYS}-day budget`,
  });

  // Cumulative: stop at the first tier with an unmet criterion.
  let tier: Tier = 0;
  for (const t of [1, 2, 3] as Tier[]) {
    const all = criteria.filter((c) => c.tier === t);
    if (all.length > 0 && all.every((c) => c.met)) tier = t;
    else break;
  }

  const firstUnmet = criteria.find((c) => c.tier === ((tier + 1) as Tier) && !c.met);

  const lapsed =
    tier < 3 && falsifiedDays !== null && Number.isFinite(falsifiedDays) && falsifiedDays > FALSIFICATION_BUDGET_DAYS
      ? `V3 was earned but has lapsed: last falsified ${Math.round(falsifiedDays)} days ago`
      : undefined;

  return {
    subject: input.subject,
    tier,
    name: TIER_NAME[tier],
    meaning: TIER_MEANING[tier],
    criteria,
    nextStep: firstUnmet ? firstUnmet.requires : null,
    ...(lapsed ? { lapsed } : {}),
  };
}

/** Short form for a badge or a sentence: "V2 RECONCILED". */
export function shortGrade(g: Grade): string {
  return `V${g.tier} ${g.name}`;
}

/**
 * What the scale explicitly does not assert.
 *
 * Rendered wherever a tier is shown. A grading framework that omits this
 * becomes a safety rating in the reader's head within about a week, and then
 * the first failure at a high tier is blamed on the scale rather than
 * understood.
 */
export const SCALE_DISCLAIMER =
  "A tier measures how much an outsider can check, not whether the system is safe, solvent or well-run. " +
  "V3 means the check has been proven able to fail — not that nothing will.";
