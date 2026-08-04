/**
 * Render the Covenant register.
 *
 * The honest shape of this page today: there are no proven defaults on Coston2,
 * so the Fail Record is empty. An empty register is not a failure of the
 * product — it is the finding, and the page says so rather than dressing up a
 * blank table. What it does carry is the standing of every agent, and the
 * executor-adoption number that decides whether the layer has a market at all.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { page, marker, stat, esc, short } from "../../design/src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "..", "out", "redemptions.json");
const OUT = join(HERE, "..", "out", "index.html");

interface Agent {
  agentVault: string;
  requested: number;
  performed: number;
  defaulted: number;
  open: number;
  adjudicated: number;
  failRateBps: number | null;
  withExecutor: number;
  valueUBA: string;
}

interface Scan {
  scannedAt: string;
  assetManager: string;
  fromBlock: string;
  toBlock: string;
  totals: {
    redemptionsRequested: number;
    performed: number;
    defaulted: number;
    openNow: number;
    withNamedExecutor: number;
    withNamedExecutorPct: number;
    distinctAgents: number;
    distinctRedeemers: number;
  };
  agents: Agent[];
  eventCounts: Record<string, number>;
}

/** XRP is 6 decimals in UBA. */
const xrp = (uba: string): string =>
  (Number(BigInt(uba) / 1000n) / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 });

const pctChip = (n: number, d: number): string => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);

function agentRow(a: Agent): string {
  // A fail rate over zero adjudications is UNKNOWN, never "clean". The chip
  // encodes that distinction rather than printing a flattering 0.
  const standing =
    a.adjudicated === 0
      ? `<span class="verdict unknown">[ ? ] NO RECORD</span>`
      : a.defaulted === 0
        ? `<span class="verdict ok">[ ✓ ] CLEAN · ${a.adjudicated} settled</span>`
        : `<span class="verdict bad">[ ✗ ] ${(a.failRateBps! / 100).toFixed(2)}% FAIL</span>`;

  return `<tr>
    <th scope="row"><a class="cite" href="https://coston2.testnet.flarescan.com/address/${esc(a.agentVault)}" target="_blank" rel="noopener">${short(a.agentVault, 12)}</a><small>agent vault</small></th>
    <td class="l">${standing}</td>
    <td>${a.requested.toLocaleString("en-US")}</td>
    <td>${a.performed.toLocaleString("en-US")}</td>
    <td>${a.defaulted}</td>
    <td>${a.open}</td>
    <td>${pctChip(a.withExecutor, a.requested)}<small>${a.withExecutor} of ${a.requested}</small></td>
    <td>${xrp(a.valueUBA)}</td>
  </tr>`;
}

function main(): void {
  const d = JSON.parse(readFileSync(IN, "utf8")) as Scan;
  const t = d.totals;
  const scanned = new Date(d.scannedAt).toISOString().replace("T", " ").slice(0, 16);
  const blocks = (BigInt(d.toBlock) - BigInt(d.fromBlock)).toLocaleString("en-US");

  const body = `
  <section>
    ${marker("Covenant · Fail Record")}
    <h1>Obligations that were owed, and provably were not performed.</h1>
    <p class="lede">Every FXRP redemption on Coston2 over the last ${esc(blocks)} blocks, joined to its
      terminal event. A redemption an agent accepted and did not settle by its deadline becomes a row
      in the record, citing the attestation round that established it. Re-derivable by anyone from
      public RPC.</p>

    <div class="stats">
      ${stat("Redemptions tracked", t.redemptionsRequested.toLocaleString("en-US"), `${t.distinctAgents} agents · ${t.distinctRedeemers} redeemers`)}
      ${stat("Settled", t.performed.toLocaleString("en-US"), pctChip(t.performed, t.redemptionsRequested) + " of tracked")}
      ${stat("Proven defaults", String(t.defaulted), t.defaulted === 0 ? "none in this window" : "on the record")}
      ${stat("Named an executor", `${t.withNamedExecutorPct}%`, `${t.withNamedExecutor.toLocaleString("en-US")} of ${t.redemptionsRequested.toLocaleString("en-US")}`)}
    </div>

    <p class="cap" style="margin-top:14px">
      Fig. 1 — Coverage at blocks ${esc(d.fromBlock)}–${esc(d.toBlock)}. AssetManagerFXRP
      <code>${esc(d.assetManager)}</code>.
    </p>

    <div class="note">
      <p><span class="tag">The record is empty</span><strong>Zero proven defaults in this window, and that is the
      finding — not a gap.</strong> Agents on Coston2 are settling: ${t.performed.toLocaleString("en-US")} of
      ${t.redemptionsRequested.toLocaleString("en-US")} redemptions performed, none defaulted. A recovery
      product whose demo depends on organic failure therefore has no demo here, which is why the failure
      modes must be manufactured deliberately on testnet and the historical replay must run against
      Songbird and mainnet where real defaults exist.</p>
      <p><strong>Why the executor number decides everything:</strong>
      <code>redemptionPaymentDefault</code> is permissioned — only the redeemer, the agent, or the executor
      appointed at <code>redeem()</code> time may call it. An unaffiliated relay cannot claim a stranger's
      default however good its proof. At <strong>${t.withNamedExecutorPct}%</strong>, naming an executor is
      already the norm, so the role does not need to be invented, only served better.</p>
    </div>
  </section>

  <section>
    <div class="eyebrow">§ 2.1 — Standing by obligor</div>
    <h2>Who settles, and who is unproven</h2>
    <p class="lede">A fail rate needs a denominator. An agent with no adjudicated redemptions is
      <em>unknown</em>, never clean — the register refuses to flatter an empty history.</p>

    <div class="tablewrap">
      <table>
        <caption>Per-agent redemption standing with settlement counts, open requests, executor adoption and value.</caption>
        <thead><tr>
          <th class="l" scope="col">Agent</th>
          <th class="l" scope="col">Standing</th>
          <th scope="col">Requested</th>
          <th scope="col">Settled</th>
          <th scope="col">Defaults</th>
          <th scope="col">Open</th>
          <th scope="col">Executor named</th>
          <th scope="col">Value (XRP)</th>
        </tr></thead>
        <tbody>
${d.agents.map(agentRow).join("\n")}
        </tbody>
      </table>
    </div>

    <div class="legend">
      <div><span class="verdict ok">[ ✓ ]</span> settled every adjudicated redemption</div>
      <div><span class="verdict bad">[ ✗ ]</span> has proven defaults on record</div>
      <div><span class="verdict unknown">[ ? ]</span> nothing adjudicated — unknown, not clean</div>
    </div>

    <p class="cap" style="margin-top:18px">
      Fig. 2 — Executor adoption varies sharply between agents (${Math.min(...d.agents.map((a) => Math.round((a.withExecutor / a.requested) * 100)))}%–${Math.max(...d.agents.map((a) => Math.round((a.withExecutor / a.requested) * 100)))}%),
      which is the spread a guardian service would compete into.
    </p>
  </section>`;

  writeFileSync(
    OUT,
    page({
      title: "Covenant — FXRP redemption record",
      description:
        "Every FXRP redemption on Flare Coston2 joined to its terminal event, with per-agent standing and executor adoption. Re-derivable from public RPC.",
      section: "covenant",
      meta: `chain 114 · blocks ${d.fromBlock}–${d.toBlock} · ${scanned}Z`,
      nav: [
        { label: "Covenant", href: "#", current: true },
        { label: "Procedure", href: "#" },
        { label: "Reprod", href: "../../reprod/out/index.html" },
      ],
      body,
    }),
    "utf8",
  );
  process.stderr.write(`→ ${OUT}\n`);
}

main();
