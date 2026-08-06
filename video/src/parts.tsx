/**
 * Shared pieces of the film's vocabulary.
 *
 * Motion here is deliberately restrained: things arrive, they do not bounce.
 * The subject is an audit register, and a control flipping red should be the
 * only dramatic moment in ninety seconds.
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, F } from "./theme";

/** Fade-and-lift, the film's only entrance. */
export const Enter: React.FC<{
  at: number;
  children: React.ReactNode;
  lift?: number;
  style?: React.CSSProperties;
}> = ({ at, children, lift = 14, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 200, mass: 0.6 } });
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${(1 - s) * lift}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** The bordered eyebrow the pages use, with its four corner marks. */
export const Marker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "relative",
      display: "inline-block",
      border: `1px solid ${C.ruleStrong}`,
      padding: "9px 20px",
      fontFamily: F.mono,
      fontSize: 15,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: C.muted,
    }}
  >
    {(
      [
        { left: -6, top: -11 },
        { right: -6, top: -11 },
        { left: -6, bottom: -11 },
        { right: -6, bottom: -11 },
      ] as const
    ).map((p, i) => (
      <b
        key={i}
        style={{ position: "absolute", fontFamily: F.mono, fontSize: 15, fontWeight: 400, ...p }}
      >
        +
      </b>
    ))}
    {children}
  </div>
);

export const H1: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 78 }) => (
  <h1
    style={{
      fontFamily: F.serif,
      fontWeight: 400,
      fontSize: size,
      lineHeight: 1.06,
      letterSpacing: "-0.018em",
      color: C.ink,
      margin: "26px 0 0",
      maxWidth: 1500,
      textWrap: "balance",
    }}
  >
    {children}
  </h1>
);

export const Lede: React.FC<{ children: React.ReactNode; width?: number }> = ({
  children,
  width = 1120,
}) => (
  <p
    style={{
      fontFamily: F.sans,
      fontWeight: 300,
      fontSize: 30,
      lineHeight: 1.55,
      color: C.muted,
      margin: "26px 0 0",
      maxWidth: width,
    }}
  >
    {children}
  </p>
);

export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: F.mono,
      fontSize: 17,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: C.faint,
    }}
  >
    {children}
  </div>
);

/** A verdict chip, carrying border style as well as colour. */
export const Verdict: React.FC<{ v: string; size?: number }> = ({ v, size = 22 }) => {
  const style =
    v === "CLEAN"
      ? { color: C.ok, border: `1px solid ${C.ok}` }
      : v === "EXCEPTION"
        ? { color: C.bad, border: `3px double ${C.bad}` }
        : { color: C.unknown, border: `1px dashed ${C.unknown}` };
  const glyph = v === "CLEAN" ? "✓" : v === "EXCEPTION" ? "✗" : "?";
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: F.mono,
        fontSize: size,
        padding: "3px 12px",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      [ {glyph} ] {v}
    </span>
  );
};

/** A figure with its label, as the pages set them. */
export const Stat: React.FC<{ k: string; v: string; n?: string; at: number }> = ({ k, v, n, at }) => (
  <Enter at={at} style={{ padding: "26px 28px", background: C.paper }}>
    <div
      style={{
        fontFamily: F.mono,
        fontSize: 15,
        textTransform: "uppercase",
        letterSpacing: "0.13em",
        color: C.faint,
      }}
    >
      {k}
    </div>
    <div
      style={{
        fontFamily: F.serif,
        fontWeight: 300,
        fontSize: 54,
        lineHeight: 1.04,
        letterSpacing: "-0.02em",
        marginTop: 12,
        color: C.ink,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {v}
    </div>
    {n ? (
      <div style={{ fontFamily: F.mono, fontSize: 15, color: C.faint, marginTop: 10 }}>{n}</div>
    ) : null}
  </Enter>
);

/** The page frame every scene sits in. */
export const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: C.paper,
      padding: "84px 110px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
    }}
  >
    {children}
  </div>
);

/**
 * A terminal transcript that types itself out.
 *
 * `reveal` is a character count driven by the frame, so the text appears at a
 * readable rate rather than all at once — the one place the film asks the
 * viewer to read along.
 */
export const Term: React.FC<{
  lines: Array<{ t: string; c?: keyof typeof TERM_COLORS; bold?: boolean }>;
  at: number;
  cps?: number;
  fontSize?: number;
}> = ({ lines, at, cps = 68, fontSize = 25 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = Math.max(0, ((frame - at) / fps) * cps);

  let used = 0;
  return (
    <div
      style={{
        background: C.termBg,
        color: C.termInk,
        fontFamily: F.mono,
        fontSize,
        lineHeight: 1.66,
        padding: "30px 34px",
        whiteSpace: "pre",
        borderRadius: 2,
      }}
    >
      {lines.map((l, i) => {
        const start = used;
        used += l.t.length + 1;
        const n = Math.floor(Math.max(0, Math.min(l.t.length, shown - start)));
        return (
          <div key={i} style={{ color: TERM_COLORS[l.c ?? "ink"], fontWeight: l.bold ? 600 : 400 }}>
            {l.t.slice(0, n) || " "}
          </div>
        );
      })}
    </div>
  );
};

export const TERM_COLORS = {
  ink: C.termInk,
  ok: C.termOk,
  bad: C.termBad,
  dim: C.termDim,
  hi: C.termHi,
} as const;

/** A hairline that draws itself left to right. */
export const Rule: React.FC<{ at: number; color?: string }> = ({ at, color = C.ruleStrong }) => {
  const frame = useCurrentFrame();
  const w = interpolate(frame - at, [0, 20], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{ height: 1, background: color, width: `${w}%`, margin: "30px 0" }} />;
};
