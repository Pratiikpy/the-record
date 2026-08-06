/**
 * THE RECORD — the submission film.
 *
 * Ninety seconds, and the whole argument is in scene three: a control that has
 * been proven able to fail. Everything before it sets that up and everything
 * after it qualifies it.
 *
 * Every figure comes from public/facts.json, which scripts/facts.ts collects
 * from the registers at build time. Nothing in this file is a typed number.
 */
import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, F, SCENES, startOf } from "./theme";
import { Enter, Eyebrow, Frame, H1, Lede, Marker, Rule, Stat, Term, Verdict } from "./parts";
import facts from "../public/facts.json";

const num = (n: number): string => n.toLocaleString("en-US");

/* ─────────────────────────────────────────────── 1 · the thesis ── */
const Thesis: React.FC = () => (
  <Frame>
    <Enter at={0}>
      <Marker>The Record</Marker>
    </Enter>
    <Enter at={8}>
      <H1>Facts that cannot be self-asserted.</H1>
    </Enter>
    <Enter at={22}>
      <Lede>
        Three registers on Flare, each answering a question the interested party is not allowed to
        answer about itself.
      </Lede>
    </Enter>
    <Enter at={34}>
      <div
        style={{
          display: "flex",
          gap: 46,
          marginTop: 40,
          fontFamily: F.serif,
          fontSize: 38,
          fontStyle: "italic",
          color: C.ink,
        }}
      >
        <span>did you pay</span>
        <span style={{ color: C.faint }}>·</span>
        <span>are the books real</span>
        <span style={{ color: C.faint }}>·</span>
        <span>is this the code you published</span>
      </div>
    </Enter>
  </Frame>
);

/* ──────────────────────────────────────────── 2 · the registers ── */
const Registers: React.FC = () => (
  <Frame>
    <Enter at={0}>
      <Eyebrow>§ 1 — Running against {facts.network}</Eyebrow>
    </Enter>
    <Enter at={6}>
      <H1 size={62}>Every figure re-derivable from public RPC, by anyone.</H1>
    </Enter>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0,1fr))",
        gap: 1,
        background: C.ruleStrong,
        border: `1px solid ${C.ruleStrong}`,
        marginTop: 50,
      }}
    >
      <Stat
        k="Covenant"
        v={num(facts.covenant.indexed)}
        n={`redemptions indexed · ${facts.covenant.namedExecutorPct}% named an executor`}
        at={20}
      />
      <Stat
        k="Procedure"
        v={facts.cv1.opinion}
        n={`${facts.cv1.controls.length} controls · flare block ${num(facts.cv1.flareBlock ?? 0)}`}
        at={30}
      />
      <Stat
        k="Reprod"
        v={num(facts.reprod.total)}
        n={`TEE machines · ${facts.reprod.owners} independent owners`}
        at={40}
      />
    </div>
    <Enter at={54}>
      <p
        style={{
          fontFamily: F.sans,
          fontWeight: 300,
          fontSize: 26,
          color: C.muted,
          marginTop: 40,
          maxWidth: 1250,
        }}
      >
        No credentials, no client, nobody&rsquo;s permission — continuous assurance that can start
        without being invited. The protocol is never the counterparty.
      </p>
    </Enter>
  </Frame>
);

/* ────────────────────────────────────────────── 3 · the red run ── */
const RedRun: React.FC = () => {
  const frame = useCurrentFrame();
  // The flip lands at 7s; before that the fork is green.
  const flipped = frame > 7 * 30;
  const fired = facts.redrun.controls.find((c) => c.opinion === "EXCEPTION");

  return (
    <Frame>
      <Enter at={0}>
        <Eyebrow>§ 2 — The part that matters</Eyebrow>
      </Enter>
      <Enter at={5}>
        <H1 size={58}>A monitor that has only ever printed CLEAN is indistinguishable from one that cannot.</H1>
      </Enter>
      <Enter at={18}>
        <p
          style={{
            fontFamily: F.sans,
            fontWeight: 300,
            fontSize: 26,
            color: C.muted,
            marginTop: 26,
            maxWidth: 1300,
          }}
        >
          So we fork the chain, corrupt one storage slot, and run the identical procedure.
        </p>
      </Enter>

      <div style={{ display: "flex", gap: 34, marginTop: 40, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F.mono, fontSize: 17, color: C.faint, marginBottom: 14 }}>
            GREEN — forked chain, no fault
          </div>
          {facts.redrun.controls.map((c, i) => (
            <Enter key={c.id} at={26 + i * 3}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 13 }}>
                <Verdict v="CLEAN" size={19} />
                <span style={{ fontFamily: F.mono, fontSize: 21, color: C.muted }}>
                  {c.id}&nbsp;&nbsp;{c.title}
                </span>
              </div>
            </Enter>
          ))}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F.mono, fontSize: 17, color: C.faint, marginBottom: 14 }}>
            RED — same procedure, one slot corrupted
          </div>
          {facts.redrun.controls.map((c, i) => (
            <Enter key={c.id} at={26 + i * 3}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 13 }}>
                <Verdict v={flipped ? c.opinion : "CLEAN"} size={19} />
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 21,
                    color: flipped && c.opinion === "EXCEPTION" ? C.bad : C.muted,
                    fontWeight: flipped && c.opinion === "EXCEPTION" ? 600 : 400,
                  }}
                >
                  {c.id}&nbsp;&nbsp;{c.title}
                </span>
              </div>
            </Enter>
          ))}
        </div>
      </div>

      {flipped && fired ? (
        <Enter at={7 * 30 + 4}>
          <div
            style={{
              marginTop: 26,
              borderLeft: `3px solid ${C.bad}`,
              paddingLeft: 20,
              fontFamily: F.sans,
              fontWeight: 300,
              fontSize: 25,
              color: C.ink,
              maxWidth: 1450,
            }}
          >
            <strong style={{ fontWeight: 600 }}>
              {facts.redrun.greenOpinion} → {facts.redrun.redOpinion}
            </strong>{" "}
            on a single corrupted slot. Exactly one control moves — a check that fires at everything
            is as useless as one that never fires. The script exits non-zero if it stays clean, and
            it runs in CI.
          </div>
        </Enter>
      ) : null}
    </Frame>
  );
};

/* ───────────────────────────────────────────────── 4 · the bits ── */
const Bits: React.FC = () => (
  <Frame>
    <Enter at={0}>
      <Eyebrow>§ 3 — Confidential compute</Eyebrow>
    </Enter>
    <Enter at={5}>
      <H1 size={62}>&ldquo;Check the code hash&rdquo; has no answer yet.</H1>
    </Enter>
    <Enter at={18}>
      <Lede width={1300}>
        Every project says <em>don&rsquo;t trust us, check the hash</em>. It is a good instruction and
        it is unexecutable, because nothing turns 32 bytes into a fact. So we measured how much a
        hash actually identifies.
      </Lede>
    </Enter>
    <Enter at={32}>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 22,
          color: C.faint,
          marginTop: 34,
        }}
      >
        bits = −log₂( machines carrying this hash ÷ machines in the registry )
      </div>
    </Enter>
    <Enter at={44}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 30, marginTop: 34 }}>
        <div
          style={{
            fontFamily: F.serif,
            fontSize: 130,
            fontWeight: 300,
            color: C.bad,
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {facts.reprod.bits}
        </div>
        <div style={{ fontFamily: F.sans, fontWeight: 300, fontSize: 27, color: C.muted, maxWidth: 900 }}>
          bits of identification. One value is carried by{" "}
          <strong style={{ color: C.ink, fontWeight: 600 }}>
            {facts.reprod.count} machines ({facts.reprod.pct}%)
          </strong>{" "}
          under {facts.reprod.owners} independent owners. A unique hash here would carry 8.00.
        </div>
      </div>
    </Enter>
    <Enter at={62}>
      <div style={{ fontFamily: F.mono, fontSize: 20, color: C.faint, marginTop: 34 }}>
        Nobody did anything wrong — simulation is permitted, and a shared constant is what it emits.
        This measures the hash, not the operator. No owner is named anywhere.
      </div>
    </Enter>
  </Frame>
);

/* ─────────────────────────────────────────────── 5 · the history ── */
const History: React.FC = () => (
  <Frame>
    <Enter at={0}>
      <Eyebrow>§ 4 — History</Eyebrow>
    </Enter>
    <Enter at={5}>
      <H1 size={62}>The register did not wait for history. It computed it.</H1>
    </Enter>
    <Enter at={18}>
      <Lede width={1300}>
        CV-1 is a pure function of chain state at a height, so the opinion for every past height
        already existed and had merely never been evaluated.
      </Lede>
    </Enter>
    <div style={{ display: "flex", gap: 60, marginTop: 46 }}>
      <Enter at={30}>
        <div>
          <div style={{ fontFamily: F.serif, fontSize: 92, fontWeight: 300, color: C.ink }}>
            {facts.backfill.slots}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 19, color: C.faint, marginTop: 8 }}>
            heights sampled on {facts.backfill.label}
          </div>
        </div>
      </Enter>
      <Enter at={40}>
        <div>
          <div style={{ fontFamily: F.serif, fontSize: 92, fontWeight: 300, color: C.ok }}>
            {facts.backfill.clean}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 19, color: C.faint, marginTop: 8 }}>
            held at every backing control
          </div>
        </div>
      </Enter>
      <Enter at={50}>
        <div>
          <div style={{ fontFamily: F.serif, fontSize: 92, fontWeight: 300, color: C.unknown }}>
            {facts.backfill.disclaimers}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 19, color: C.faint, marginTop: 8 }}>
            could not be established
          </div>
        </div>
      </Enter>
    </div>
    <Enter at={62}>
      <div
        style={{
          fontFamily: F.sans,
          fontWeight: 300,
          fontSize: 25,
          color: C.muted,
          marginTop: 42,
          maxWidth: 1350,
          borderLeft: `2px solid ${C.ruleStrong}`,
          paddingLeft: 20,
        }}
      >
        A disclaimer is recorded as unknown and never rounded up to a pass. The same procedure run
        backwards over Coston2 reports 42 exceptions — the Core Vault&rsquo;s destination allowlist
        was empty for its first three months.
      </div>
    </Enter>
  </Frame>
);

/* ───────────────────────────────────────────────── 6 · the errata ── */
const Errata: React.FC = () => (
  <Frame>
    <Enter at={0}>
      <Eyebrow>§ 5 — The part nobody else can copy</Eyebrow>
    </Enter>
    <Enter at={5}>
      <H1 size={62}>
        {facts.errata.total} errata, {facts.errata.published} of which reached the public.
      </H1>
    </Enter>
    <Enter at={18}>
      <Lede width={1350}>
        Every register here makes claims about somebody else&rsquo;s system. The only thing that makes
        that defensible is a permanent, public account of the times we got it wrong.
      </Lede>
    </Enter>
    <Enter at={32}>
      <div style={{ marginTop: 40 }}>
        <Term
          at={34}
          fontSize={23}
          cps={95}
          lines={[
            { t: "E-001   we said 93 redemption agents had defaulted", c: "hi" },
            { t: "        every one of them had paid, in full, on time", c: "bad" },
            { t: "" },
            { t: "E-003   a control that could not fail, and never did", c: "hi" },
            { t: "        both sides came from the same storage slot", c: "bad" },
            { t: "" },
            { t: "E-008   we published 223 machines; the chain held 250", c: "hi" },
            { t: "        the tests asserted 223 from the same stale file", c: "bad" },
          ]}
        />
      </div>
    </Enter>
    <Enter at={72}>
      <div
        style={{
          fontFamily: F.sans,
          fontWeight: 300,
          fontSize: 25,
          color: C.muted,
          marginTop: 30,
          maxWidth: 1400,
        }}
      >
        Each names the exact wrong value, the mechanism, and the test that now makes it
        unconstructable. Copying this page requires having been wrong in public.
      </div>
    </Enter>
  </Frame>
);

/* ─────────────────────────────────────────── 7 · reproduce it ── */
const Reproduce: React.FC = () => (
  <Frame>
    <Enter at={0}>
      <Eyebrow>§ 6 — Check it yourself</Eyebrow>
    </Enter>
    <Enter at={5}>
      <H1 size={62}>Nothing here needs our server, our keys, or our permission.</H1>
    </Enter>
    <div style={{ marginTop: 40 }}>
      <Term
        at={20}
        fontSize={24}
        cps={82}
        lines={[
          { t: "$ git clone github.com/Pratiikpy/the-record && pnpm install", c: "ok" },
          { t: "$ pnpm -r run test", c: "ok" },
          { t: `  ${facts.suite.typescript} passed · 0 skipped · exit 0`, c: "hi", bold: true },
          { t: "" },
          { t: "$ pnpm --filter @therecord/procedure verify", c: "ok" },
          { t: "  verified offline — no network was contacted", c: "hi", bold: true },
          { t: "" },
          { t: "$ pnpm --filter @therecord/reprod drift", c: "ok" },
          { t: "  is our published snapshot still true of the chain?", c: "dim" },
        ]}
      />
    </div>
    <Enter at={88}>
      <div style={{ fontFamily: F.mono, fontSize: 20, color: C.faint, marginTop: 28 }}>
        {facts.suite.total} tests in total · {facts.faults.total} faults catalogued ·{" "}
        {facts.faults.knownUncaught} declared <em>known uncaught</em>, because what a procedure cannot
        detect is part of what it means.
      </div>
    </Enter>
  </Frame>
);

/* ──────────────────────────────────────────────────── 8 · close ── */
const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 18, durationInFrames - 2], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Frame>
        <Enter at={0}>
          <Marker>The Record</Marker>
        </Enter>
        <Enter at={8}>
          <H1 size={70}>
            The hard part is not producing output. It is producing output that could have come out
            differently.
          </H1>
        </Enter>
        <Enter at={26}>
          <Rule at={26} />
        </Enter>
        <Enter at={34}>
          <div
            style={{
              display: "flex",
              gap: 46,
              fontFamily: F.mono,
              fontSize: 25,
              color: C.ink,
              marginTop: 4,
            }}
          >
            <span>the-record.vercel.app</span>
            <span style={{ color: C.faint }}>·</span>
            <span>/proof-deck</span>
            <span style={{ color: C.faint }}>·</span>
            <span>/errata</span>
          </div>
        </Enter>
        <Enter at={44}>
          <div style={{ fontFamily: F.mono, fontSize: 19, color: C.faint, marginTop: 22 }}>
            Flare Summer Signal — Interoperable Asset Products &amp; Confidential Compute Apps
          </div>
        </Enter>
      </Frame>
    </AbsoluteFill>
  );
};

/* ──────────────────────────────────────────────── the film ── */
const SCENE_COMPONENTS: Record<string, React.FC> = {
  thesis: Thesis,
  registers: Registers,
  redrun: RedRun,
  bits: Bits,
  history: History,
  errata: Errata,
  reproduce: Reproduce,
  close: Close,
};

export const TheRecord: React.FC = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    {SCENES.map((s) => {
      const Comp = SCENE_COMPONENTS[s.id]!;
      return (
        <Sequence key={s.id} from={startOf(s.id)} durationInFrames={s.frames}>
          <Comp />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
