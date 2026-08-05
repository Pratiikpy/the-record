/**
 * The badge, and the API it is a view of.
 *
 * Every assurance product that mattered spread the same way: the subject
 * embedded something. Sourcify's verified mark, shields.io, L2Beat's stage
 * label. A register that can only be visited stays a page; a register the
 * subject links to becomes the reference.
 *
 * So the badge is deliberately built to be embeddable in the places a reader
 * already is — a README, a docs page, an explorer listing — and it carries the
 * one thing a dashboard screenshot cannot: the verdict and its age, together.
 *
 * ── WHY AGE IS ON THE BADGE ────────────────────────────────────────────────
 *
 * A stale green badge is worse than no badge. It says "verified" about a
 * moment that may be months gone, and the reader has no way to tell. Every
 * badge here therefore renders its own age, and a badge past its freshness
 * budget renders as STALE rather than continuing to show the last good news.
 * That is the same rule as DISCLAIMER never rolling up as CLEAN, applied to a
 * surface that will be screenshotted and reposted out of context.
 */

export type BadgeState = "CLEAN" | "EXCEPTION" | "DISCLAIMER" | "STALE" | "UNKNOWN";

/**
 * Palette. Deliberately not the page palette: a badge sits on somebody else's
 * background, so it cannot inherit `--paper` and must carry its own contrast.
 */
const COLOURS: Record<BadgeState, { fill: string; text: string }> = {
  CLEAN: { fill: "#3F6F4B", text: "#FFFFFF" },
  EXCEPTION: { fill: "#8C3A2E", text: "#FFFFFF" },
  DISCLAIMER: { fill: "#7A6A3F", text: "#FFFFFF" },
  STALE: { fill: "#6E6A64", text: "#FFFFFF" },
  UNKNOWN: { fill: "#4A4742", text: "#FFFFFF" },
};

/** How long a verdict may be shown before the badge stops vouching for it. */
export const DEFAULT_FRESHNESS_HOURS = 36;

export interface BadgeInput {
  /** left-hand label, e.g. "FXRP core vault" */
  subject: string;
  state: BadgeState;
  /** ISO timestamp the underlying opinion was produced */
  generatedAt: string;
  /** evaluated against generatedAt; defaults to now */
  now?: Date;
  freshnessHours?: number;
}

export interface BadgeResult {
  svg: string;
  /** the state actually rendered, after the staleness rule */
  rendered: BadgeState;
  ageHours: number;
}

/** Monospace-ish width estimate; the badge font is 11px system sans. */
function textWidth(s: string, px = 11): number {
  // Average advance for the fallback stack, measured rather than guessed at
  // 0.6em -- narrower glyphs are common in these strings (digits, spaces).
  return Math.ceil(s.length * px * 0.58) + 2;
}

const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export function formatAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Render the badge.
 *
 * Pure and synchronous so it can be unit-tested and served from a static file
 * without a runtime. The staleness decision is made here rather than by the
 * caller, because a caller that forgets it publishes a lie.
 */
export function badge(input: BadgeInput): BadgeResult {
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(input.generatedAt);
  const ageHours = Number.isFinite(ageMs) ? ageMs / 3_600_000 : Number.POSITIVE_INFINITY;
  const budget = input.freshnessHours ?? DEFAULT_FRESHNESS_HOURS;

  // A badge past its budget stops reporting the last good news. It does not
  // matter that the verdict was true when it was made.
  // A negative age means the report claims to be from the future. That is not
  // freshness, it is a broken clock or a period mistaken for a timestamp -- and
  // treating it as fresh would let a badge vouch indefinitely.
  const rendered: BadgeState = !Number.isFinite(ageHours)
    ? "UNKNOWN"
    : ageHours < -0.05
      ? "UNKNOWN"
      : ageHours > budget
        ? "STALE"
        : input.state;

  const right = rendered === "STALE" ? `STALE · ${formatAge(ageHours)}` : `${rendered} · ${formatAge(ageHours)}`;
  const left = input.subject;

  const lw = textWidth(left) + 16;
  const rw = textWidth(right) + 16;
  const w = lw + rw;
  const h = 20;
  const c = COLOURS[rendered];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${escapeXml(`${left}: ${right}`)}">
  <title>${escapeXml(`${left}: ${right}`)}</title>
  <rect width="${lw}" height="${h}" fill="#1F1E1D"/>
  <rect x="${lw}" width="${rw}" height="${h}" fill="${c.fill}"/>
  <g font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14" fill="#FAF9F5" text-anchor="middle">${escapeXml(left)}</text>
    <text x="${lw + rw / 2}" y="14" fill="${c.text}" text-anchor="middle">${escapeXml(right)}</text>
  </g>
</svg>`;

  return { svg, rendered, ageHours: Number.isFinite(ageHours) ? ageHours : -1 };
}

/**
 * The machine-readable half.
 *
 * A badge is a picture; anything building on this needs the same facts as
 * data. Both are generated from one input so they can never disagree — a
 * status page whose JSON says EXCEPTION while its badge says CLEAN is the
 * exact failure this project exists to prevent.
 */
export interface StatusDocument {
  schema: "therecord.status/v1";
  subject: string;
  state: BadgeState;
  /** the state before the staleness rule, so a reader can see both */
  reportedState: BadgeState;
  generatedAt: string;
  ageHours: number;
  stale: boolean;
  freshnessHours: number;
  /** where the full, human-readable evidence lives */
  href?: string;
  /** digest of the evidence the verdict was computed from */
  evidenceDigest?: string;
}

export function statusDocument(
  input: BadgeInput & { href?: string; evidenceDigest?: string },
): StatusDocument {
  const b = badge(input);
  return {
    schema: "therecord.status/v1",
    subject: input.subject,
    state: b.rendered,
    reportedState: input.state,
    generatedAt: input.generatedAt,
    ageHours: Math.round(b.ageHours * 100) / 100,
    stale: b.rendered === "STALE",
    freshnessHours: input.freshnessHours ?? DEFAULT_FRESHNESS_HOURS,
    ...(input.href ? { href: input.href } : {}),
    ...(input.evidenceDigest ? { evidenceDigest: input.evidenceDigest } : {}),
  };
}
