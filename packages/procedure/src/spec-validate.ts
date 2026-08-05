/**
 * Validate a `faults.json` against the spec.
 *
 * A specification nobody can check is a blog post. This makes the three rules
 * in SPEC.md mechanical, so a suite that quietly drops `mustNotMove` or ships
 * an empty `knownUncaught` fails a command rather than passing a code review.
 *
 * It validates OTHER people's files as readily as ours — that is the point. The
 * formats are only worth anything if they are adoptable without us, and a
 * validator someone can run against their own monitor is the cheapest possible
 * proof that the format is real.
 */

export interface SpecFault {
  id?: unknown;
  title?: unknown;
  class?: unknown;
  proves?: unknown;
  doesNotProve?: unknown;
  mustFire?: unknown;
  mustNotMove?: unknown;
}

export interface SpecFile {
  schema?: unknown;
  faults?: unknown;
  knownUncaught?: unknown;
}

export interface Violation {
  /** where, e.g. "faults[2].mustNotMove" */
  at: string;
  /** what is wrong */
  problem: string;
  /** why the rule exists — a validator that only says "invalid" teaches nothing */
  because: string;
}

const VALID_CLASSES = new Set(["chain-state", "transport", "null"]);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Check a parsed faults file.
 *
 * Returns every violation rather than the first, because a suite being brought
 * up to spec wants the whole list, not a game of whack-a-mole.
 */
export function validateFaultsFile(file: SpecFile): Violation[] {
  const v: Violation[] = [];

  if (file.schema !== "therecord.faults/v1") {
    v.push({
      at: "schema",
      problem: `expected "therecord.faults/v1", got ${JSON.stringify(file.schema)}`,
      because: "a consumer must be able to reject a format it does not understand rather than guess",
    });
  }

  if (!Array.isArray(file.faults) || file.faults.length === 0) {
    v.push({
      at: "faults",
      problem: "must be a non-empty array",
      because: "a suite with no faults has never demonstrated that any check can fail",
    });
    return v;
  }

  const faults = file.faults as SpecFault[];
  const seen = new Set<string>();
  let hasNull = false;

  faults.forEach((f, i) => {
    const at = `faults[${i}]`;

    if (typeof f.id !== "string" || f.id.length === 0) {
      v.push({ at: `${at}.id`, problem: "missing", because: "a fault must be citable" });
    } else if (seen.has(f.id)) {
      v.push({
        at: `${at}.id`,
        problem: `duplicate id ${f.id}`,
        because: "two faults sharing an id make results ambiguous",
      });
    } else {
      seen.add(f.id);
    }

    if (typeof f.class !== "string" || !VALID_CLASSES.has(f.class)) {
      v.push({
        at: `${at}.class`,
        problem: `expected one of ${[...VALID_CLASSES].join(", ")}, got ${JSON.stringify(f.class)}`,
        because: "the transport class is the one most suites lack entirely, so it must be nameable",
      });
    }
    if (f.class === "null") hasNull = true;

    if (typeof f.proves !== "string" || f.proves.trim().length < 20) {
      v.push({
        at: `${at}.proves`,
        problem: "missing or too short to be meaningful",
        because: "a fault whose purpose cannot be stated in a sentence has not been thought through",
      });
    }

    // Rule 2 of the spec.
    if (typeof f.doesNotProve !== "string" || f.doesNotProve.trim().length < 20) {
      v.push({
        at: `${at}.doesNotProve`,
        problem: "missing or too short",
        because:
          "fault injection shows a check CAN fire for one fault class; it says nothing about whether the check asserts the right invariant",
      });
    }

    if (!isStringArray(f.mustFire)) {
      v.push({ at: `${at}.mustFire`, problem: "must be an array of control ids", because: "the fired set has to be checkable" });
    }

    // Rule 1 of the spec, and the one most often missing.
    if (!isStringArray(f.mustNotMove) || (f.mustNotMove as string[]).length === 0) {
      v.push({
        at: `${at}.mustNotMove`,
        problem: "missing or empty",
        because:
          "a check that fires on everything is no more informative than one that fires on nothing; without this the false-positive half is untested",
      });
    }

    if (isStringArray(f.mustFire) && isStringArray(f.mustNotMove)) {
      const overlap = f.mustFire.filter((x) => (f.mustNotMove as string[]).includes(x));
      if (overlap.length > 0) {
        v.push({
          at,
          problem: `${overlap.join(", ")} is in both mustFire and mustNotMove`,
          because: "a control cannot be required to both fire and stay put",
        });
      }
    }

    if (isStringArray(f.mustFire) && f.mustFire.length === 0 && f.class !== "null") {
      // Permitted, but only deliberately: some faults prove a DISCLAIMER rather
      // than an exception. Flagged as advisory rather than fatal is not a thing
      // this validator does, so it is stated in `proves` instead.
    }
  });

  if (!hasNull) {
    v.push({
      at: "faults",
      problem: "no fault of class \"null\"",
      because:
        "a harness that reports success on a no-op fault is decorative, and that cannot be detected from outside — inject nothing and require the run to fail",
    });
  }

  // Rule 3 of the spec.
  if (!Array.isArray(file.knownUncaught) || file.knownUncaught.length === 0) {
    v.push({
      at: "knownUncaught",
      problem: "missing or empty",
      because:
        "a suite that catches every fault it contains has told you about its author, not the system; publishing what you inject and miss is the only evidence the list was adversarial",
    });
  } else {
    (file.knownUncaught as Array<{ title?: unknown; why?: unknown }>).forEach((u, i) => {
      if (typeof u.title !== "string" || typeof u.why !== "string" || u.why.trim().length < 30) {
        v.push({
          at: `knownUncaught[${i}]`,
          problem: "needs a title and a substantive why",
          because: "an uncaught fault without a reason is an admission, not a finding",
        });
      }
    });
  }

  return v;
}

export function formatViolations(vs: readonly Violation[]): string {
  if (vs.length === 0) return "valid — conforms to therecord.faults/v1";
  return [
    `${vs.length} violation${vs.length === 1 ? "" : "s"}:`,
    ...vs.map((x) => `  ✗ ${x.at}\n      ${x.problem}\n      why: ${x.because}`),
  ].join("\n");
}
