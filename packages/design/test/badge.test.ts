import { describe, it, expect } from "vitest";
import { badge, statusDocument, formatAge, DEFAULT_FRESHNESS_HOURS } from "../src/badge.js";

const AT = "2026-08-05T00:00:00.000Z";
const at = (hoursLater: number): Date => new Date(Date.parse(AT) + hoursLater * 3_600_000);

const base = { subject: "FXRP core vault", generatedAt: AT } as const;

describe("staleness", () => {
  it("shows the verdict while it is fresh", () => {
    expect(badge({ ...base, state: "CLEAN", now: at(2) }).rendered).toBe("CLEAN");
  });

  it("STOPS showing good news once the budget is exceeded", () => {
    // A stale green badge is worse than no badge: it vouches for a moment the
    // reader cannot see the age of.
    const r = badge({ ...base, state: "CLEAN", now: at(DEFAULT_FRESHNESS_HOURS + 1) });
    expect(r.rendered).toBe("STALE");
    expect(r.svg).not.toContain("CLEAN");
  });

  it("goes stale exactly one hour past the budget, not before", () => {
    expect(badge({ ...base, state: "CLEAN", now: at(DEFAULT_FRESHNESS_HOURS) }).rendered).toBe("CLEAN");
    expect(badge({ ...base, state: "CLEAN", now: at(DEFAULT_FRESHNESS_HOURS + 0.01) }).rendered).toBe("STALE");
  });

  it("hides a stale EXCEPTION too — staleness is not a way to keep bad news up", () => {
    expect(badge({ ...base, state: "EXCEPTION", now: at(200) }).rendered).toBe("STALE");
  });

  it("honours a custom freshness budget", () => {
    expect(badge({ ...base, state: "CLEAN", now: at(5), freshnessHours: 4 }).rendered).toBe("STALE");
  });

  it("REGRESSION: a future-dated report is UNKNOWN, not fresh forever", () => {
    // The first build anchored CV-1's `period` to end-of-day, which is in the
    // future, producing an age of -21h. A negative age passed the budget check
    // trivially, so the badge could never go stale.
    const r = badge({ ...base, state: "CLEAN", now: at(-21) });
    expect(r.rendered).toBe("UNKNOWN");
    expect(r.rendered).not.toBe("CLEAN");
  });

  it("tolerates sub-minute clock skew rather than flapping to UNKNOWN", () => {
    expect(badge({ ...base, state: "CLEAN", now: at(-0.01) }).rendered).toBe("CLEAN");
  });

  it("renders UNKNOWN rather than guessing when the timestamp is unparseable", () => {
    const r = badge({ subject: "x", state: "CLEAN", generatedAt: "not-a-date", now: at(1) });
    expect(r.rendered).toBe("UNKNOWN");
    expect(r.ageHours).toBe(-1);
  });
});

describe("the SVG", () => {
  it("is well-formed and self-contained", () => {
    const { svg } = badge({ ...base, state: "CLEAN", now: at(1) });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    // Must not depend on anything it cannot carry: it renders on someone
    // else's page, with their CSS and no network access to us.
    expect(svg).not.toMatch(/<image|href=|url\(|@import/u);
  });

  it("carries an accessible name, not just colour", () => {
    const { svg } = badge({ ...base, state: "EXCEPTION", now: at(1) });
    expect(svg).toMatch(/role="img"/u);
    expect(svg).toMatch(/aria-label="[^"]+"/u);
    expect(svg).toMatch(/<title>/u);
    // The state must be readable as text, so a greyscale or colourblind reader
    // is not left guessing from the fill alone.
    expect(svg).toContain("EXCEPTION");
  });

  it("escapes a subject that contains markup", () => {
    const { svg } = badge({ subject: '<script>&"', state: "CLEAN", generatedAt: AT, now: at(1) });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("always states its own age", () => {
    expect(badge({ ...base, state: "CLEAN", now: at(3) }).svg).toContain("3h ago");
  });

  it("widens to fit a long subject instead of clipping", () => {
    const narrow = badge({ subject: "a", state: "CLEAN", generatedAt: AT, now: at(1) }).svg;
    const wide = badge({ subject: "a".repeat(40), state: "CLEAN", generatedAt: AT, now: at(1) }).svg;
    const w = (s: string): number => Number(/width="(\d+)"/u.exec(s)![1]);
    expect(w(wide)).toBeGreaterThan(w(narrow));
  });
});

describe("formatAge", () => {
  it("reads naturally across scales", () => {
    expect(formatAge(0.25)).toBe("15m ago");
    expect(formatAge(3)).toBe("3h ago");
    expect(formatAge(72)).toBe("3d ago");
  });

  it("never reports zero minutes", () => {
    expect(formatAge(0.001)).toBe("1m ago");
  });
});

describe("statusDocument", () => {
  it("cannot disagree with the badge — both come from one input", () => {
    const input = { ...base, state: "CLEAN" as const, now: at(100) };
    const doc = statusDocument(input);
    const b = badge(input);
    expect(doc.state).toBe(b.rendered);
    expect(doc.state).toBe("STALE");
  });

  it("preserves the underlying verdict alongside the rendered one", () => {
    const doc = statusDocument({ ...base, state: "EXCEPTION", now: at(500) });
    expect(doc.state).toBe("STALE");
    expect(doc.reportedState).toBe("EXCEPTION");
    expect(doc.stale).toBe(true);
  });

  it("carries a schema so consumers can version against it", () => {
    expect(statusDocument({ ...base, state: "CLEAN", now: at(1) }).schema).toBe("therecord.status/v1");
  });

  it("links to the evidence and names the digest when given them", () => {
    const doc = statusDocument({
      ...base,
      state: "CLEAN",
      now: at(1),
      href: "https://example.test/procedure/",
      evidenceDigest: "0xabc",
    });
    expect(doc.href).toBe("https://example.test/procedure/");
    expect(doc.evidenceDigest).toBe("0xabc");
  });
});
