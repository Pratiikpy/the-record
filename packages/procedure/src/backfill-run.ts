/**
 * Evaluate CV-1 across historical heights, honestly.
 *
 * The engine is the easy half. The hard half is not manufacturing findings.
 *
 * A live register reads both chains once and never revisits the gap between
 * them. A backfill re-runs that same ambiguity hundreds of times, so any
 * systematic bias becomes hundreds of published exceptions. Flare blocks and
 * XRPL ledgers close on independent clocks: a pair matched to the same instant
 * can still straddle an EscrowCreate, and the result looks exactly like a
 * genuine backing shortfall.
 *
 * So every candidate exception is evaluated three times — at the paired XRPL
 * ledger and at ledgers roughly a minute either side. An EXCEPTION is only
 * published if it survives all three. If it appears at one height and not
 * another, the row becomes a DISCLAIMER naming the skew, because that is what
 * we actually know: not that the vault was short, but that we cannot tell from
 * two chains sampled a few seconds apart.
 *
 * This is strictly more evidence than a live run produces. The defence against
 * the backfill's weakness turns out to be the thing that makes it stronger — a
 * cron cannot produce a skew bracket at all.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { type PublicClient, type Address } from "viem";

import {
  buildManifest,
  makeClient,
  xrplLedgerCloseTime,
  XRPL_FLOOR_ISO,
  XRPL_RETENTION_FLOOR,
  type HeightRow,
} from "./backfill.js";
import { runCv1, type CoreVaultState, type Cv1Report, type Opinion } from "./cv1.js";
import { selectNetwork, clientFor, resolveAddresses } from "./network.js";
import type { XrplTx } from "./xrpl.js";
import { adjudicateSkew } from "./faults.js";
import type { ResolvedAddresses } from "./network.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, "..", "out");
const MANIFEST = join(OUTDIR, "manifest.json");
const SERIES = join(OUTDIR, "backfill.json");

const STEP = Number(process.env.BACKFILL_STEP_SECONDS ?? 6 * 3600);
/** How far either side of the paired ledger to bracket, in XRPL ledgers (~4s each). */
const BRACKET_LEDGERS = 15;

const log = (m: string): void => void process.stderr.write(`${m}\n`);

const cvmAbi = [
  { type: "function", name: "coreVaultAddress", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "custodianAddress", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "availableFunds", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "escrowedFunds", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "function",
    name: "getAllowedDestinationAddresses",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string[]" }],
  },
] as const;

const amAbi = [
  {
    type: "function",
    name: "coreVaultAvailableAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "immediatelyAvailableUBA", type: "uint256" },
      { name: "totalAvailableUBA", type: "uint256" },
    ],
  },
] as const;

/** Everything CV-1 needs from Flare, read at one historical block. */
async function flareStateAt(
  client: PublicClient,
  block: number,
  CORE_VAULT_MANAGER: Address,
  ASSET_MANAGER_FXRP: Address,
): Promise<Omit<CoreVaultState, "onLedger"> | null> {
  const b = BigInt(block);
  try {
    // Mainnet public RPC rate-limits; a short pause between rows keeps a long
    // backfill inside the budget instead of dying two-thirds of the way in.
    await new Promise((r) => setTimeout(r, Number(process.env.BACKFILL_PACE_MS ?? 150)));
    const [coreVaultAddress, custodianAddress, availableFunds, escrowedFunds, allowed, amounts] =
      await Promise.all([
        client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "coreVaultAddress", blockNumber: b }),
        client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "custodianAddress", blockNumber: b }),
        client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "availableFunds", blockNumber: b }),
        client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "escrowedFunds", blockNumber: b }),
        client.readContract({ address: CORE_VAULT_MANAGER, abi: cvmAbi, functionName: "getAllowedDestinationAddresses", blockNumber: b }),
        client.readContract({ address: ASSET_MANAGER_FXRP, abi: amAbi, functionName: "coreVaultAvailableAmount", blockNumber: b }),
      ]);
    return {
      coreVaultAddress,
      custodianAddress,
      allowedDestinations: [...allowed],
      availableFundsUBA: availableFunds.toString(),
      escrowedFundsUBA: escrowedFunds.toString(),
      immediatelyAvailableUBA: amounts[0].toString(),
      reportedTotalUBA: amounts[1].toString(),
    };
  } catch {
    // The contract may not exist yet at this height, which is a fact about the
    // period rather than an error — the caller turns it into a DISCLAIMER.
    return null;
  }
}

// Must follow the network. Reconciling Flare mainnet against XRPL testnet
// would compare a real vault to an unrelated ledger and report it confidently.
const XRPL_ENDPOINTS: readonly string[] =
  (process.env.NETWORK ?? "flare").toLowerCase() === "coston2"
    ? ["https://s.altnet.rippletest.net:51234", "https://testnet.xrpl-labs.com"]
    : ["https://xrplcluster.com", "https://s2.ripple.com:51234"];

async function xrplAt(
  account: string,
  ledger: number,
): Promise<{ balanceDrops: bigint; escrowedDrops: bigint; escrowCount: number; nonXrpEscrows: number } | null> {
  for (const url of XRPL_ENDPOINTS) {
    try {
      const post = async (body: unknown): Promise<Record<string, unknown>> => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25_000),
        });
        return JSON.parse(await res.text()) as Record<string, unknown>;
      };

      const info = (await post({
        method: "account_info",
        params: [{ account, ledger_index: ledger }],
      })) as { result?: { status?: string; account_data?: { Balance?: string } } };
      if (info.result?.status !== "success") return null;
      const bal = info.result.account_data?.Balance;
      if (typeof bal !== "string") return null;

      let escrowed = 0n;
      let count = 0;
      let nonXrp = 0;
      let marker: unknown = undefined;
      for (let page = 0; page < 50; page++) {
        const objs = (await post({
          method: "account_objects",
          params: [
            { account, ledger_index: ledger, type: "escrow", limit: 400, ...(marker === undefined ? {} : { marker }) },
          ],
        })) as { result?: { status?: string; account_objects?: Array<Record<string, unknown>>; marker?: unknown } };
        if (objs.result?.status !== "success") return null;
        for (const o of objs.result.account_objects ?? []) {
          if (typeof o.Amount !== "string") { nonXrp++; continue; }
          escrowed += BigInt(o.Amount);
          count++;
        }
        marker = objs.result.marker;
        if (marker === undefined || marker === null) break;
      }
      return { balanceDrops: BigInt(bal), escrowedDrops: escrowed, escrowCount: count, nonXrpEscrows: nonXrp };
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

export interface BackfillRow {
  utc: string;
  /**
   * Never omitted, never inferred from context. A retrospective row is exactly
   * as re-derivable as a live one, and was not published at the time.
   */
  derivation: "retrospective";
  flareBlock: number;
  xrplLedger: number;
  skewSeconds: number;
  opinion: Opinion;
  controls: Array<{ id: string; opinion: Opinion }>;
  availableFundsUBA?: string;
  escrowedFundsUBA?: string;
  onLedgerEscrowedDrops?: string;
  escrowCount?: number;
  /** the C5 fee wedge, so its drift is a series rather than a per-run aside */
  wedgeUBA?: string;
  evidenceDigest?: string;
  /** set when the skew bracket refused to confirm a candidate exception */
  skewNote?: string;
  disclaimer?: string;
}

/** CV-1 needs transactions for C1; historical outflows are out of scope here. */
const NO_TXS: XrplTx[] = [];

/**
 * The controls this series is actually scoped to.
 *
 * C1 tests outflow destinations and needs a reconstructed transaction window,
 * which this engine does not build. Rolling C1's unavoidable DISCLAIMER into
 * the period opinion made *every* backfilled row DISCLAIMER — technically true
 * and completely uninformative, a series that says nothing 950 times.
 *
 * The honest fix is not to drop the disclaimer but to narrow the claim: this is
 * a BACKING series, and it says so in its own name. Rolling up only the
 * controls in scope, and publishing the scope beside the verdict, is the
 * difference between a narrow claim and an overclaim.
 */
const SCOPE = ["C2", "C3", "C4", "C5"] as const;

function rollUpScoped(controls: ReadonlyArray<{ id: string; opinion: Opinion }>): Opinion {
  const inScope = controls.filter((c) => (SCOPE as readonly string[]).includes(c.id));
  if (inScope.some((c) => c.opinion === "EXCEPTION")) return "EXCEPTION";
  if (inScope.some((c) => c.opinion === "DISCLAIMER")) return "DISCLAIMER";
  return "CLEAN";
}

/**
 * One row, with the skew bracket applied to any candidate exception.
 *
 * C1 always disclaims here (no transaction window is reconstructed), so the
 * period opinion is bounded by DISCLAIMER by construction. That is the honest
 * outcome: this series is evidence about backing, not about outflows, and
 * pretending otherwise would be the quiet kind of overclaim.
 */
async function evaluateRow(client: PublicClient, h: HeightRow, addrs: ResolvedAddresses): Promise<BackfillRow> {
  const base: BackfillRow = {
    utc: h.utc,
    derivation: "retrospective",
    flareBlock: h.flareBlock,
    xrplLedger: h.xrplLedger,
    skewSeconds: h.skewSeconds,
    opinion: "DISCLAIMER",
    controls: [],
  };

  const flare = await flareStateAt(client, h.flareBlock, addrs.coreVaultManager, addrs.assetManager);
  if (!flare) {
    return { ...base, disclaimer: "CoreVaultManager had no code at this Flare block" };
  }

  const xrpl = await xrplAt(flare.coreVaultAddress, h.xrplLedger);
  if (!xrpl) {
    return { ...base, disclaimer: "no public XRPL server retained this ledger for the vault account" };
  }

  const state: CoreVaultState = {
    ...flare,
    onLedger: {
      balanceDrops: xrpl.balanceDrops.toString(),
      escrowedDrops: xrpl.escrowedDrops.toString(),
      escrowCount: xrpl.escrowCount,
      // Reserve is a live ledger parameter and is not retrievable historically;
      // the base+owner reserve is small relative to the balances under test, and
      // C4 only breaches when the claim EXCEEDS spendable, so omitting it is the
      // conservative direction — it can never manufacture an exception.
      reserveDrops: "0",
      nonXrpEscrows: xrpl.nonXrpEscrows,
    },
  };

  const report: Cv1Report = runCv1(NO_TXS, state, h.utc.slice(0, 10));
  const wedge =
    flare.immediatelyAvailableUBA !== undefined
      ? (BigInt(flare.availableFundsUBA) - BigInt(flare.immediatelyAvailableUBA)).toString()
      : undefined;

  const controls = report.controls.map((c) => ({ id: c.id, opinion: c.opinion }));
  const row: BackfillRow = {
    ...base,
    opinion: rollUpScoped(controls),
    controls,
    availableFundsUBA: flare.availableFundsUBA,
    escrowedFundsUBA: flare.escrowedFundsUBA,
    onLedgerEscrowedDrops: xrpl.escrowedDrops.toString(),
    escrowCount: xrpl.escrowCount,
    wedgeUBA: wedge,
    evidenceDigest: report.evidence.evidenceDigest,
  };

  const exceptional = controls
    .filter((c) => c.opinion === "EXCEPTION" && (SCOPE as readonly string[]).includes(c.id))
    .map((c) => c.id);
  if (exceptional.length === 0) return row;

  // ── The skew bracket. Re-evaluate at ±BRACKET_LEDGERS; an exception that
  // does not survive the bracket is a sampling artifact, and publishing it
  // would be a false accusation at industrial scale.
  const neighbours = [h.xrplLedger - BRACKET_LEDGERS, h.xrplLedger + BRACKET_LEDGERS];
  const survived: boolean[] = [];
  for (const n of neighbours) {
    const alt = await xrplAt(flare.coreVaultAddress, n);
    if (!alt) continue;
    const altReport = runCv1(NO_TXS, {
      ...state,
      onLedger: {
        balanceDrops: alt.balanceDrops.toString(),
        escrowedDrops: alt.escrowedDrops.toString(),
        escrowCount: alt.escrowCount,
        reserveDrops: "0",
        nonXrpEscrows: alt.nonXrpEscrows,
      },
    }, h.utc.slice(0, 10));
    survived.push(altReport.controls.some((c) => exceptional.includes(c.id) && c.opinion === "EXCEPTION"));
  }

  const verdict = adjudicateSkew(exceptional, survived);
  if (verdict.confirmed) return row;

  const t = await xrplLedgerCloseTime(neighbours[1]!);
  const span = t !== null ? Math.abs(t - h.xrplUnix) : BRACKET_LEDGERS * 4;
  return {
    ...row,
    opinion: "DISCLAIMER",
    controls: row.controls.map((c) =>
      exceptional.includes(c.id) ? { id: c.id, opinion: "DISCLAIMER" as Opinion } : c,
    ),
    skewNote: `${exceptional.join(", ")}: ${verdict.reason} (±${BRACKET_LEDGERS} ledgers, ~${Math.round(span)}s)`,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUTDIR, { recursive: true });

  const toUnix = Math.floor(Date.now() / 1000);
  const fromUnix = Math.floor(Date.parse(process.env.BACKFILL_FROM ?? XRPL_FLOOR_ISO) / 1000);

  let manifest: HeightRow[];
  if (existsSync(MANIFEST) && process.env.BACKFILL_REBUILD_MANIFEST !== "1") {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as HeightRow[];
    log(`manifest: ${manifest.length} slots (cached)`);
  } else {
    log(`resolving heights from ${new Date(fromUnix * 1000).toISOString()} every ${STEP}s…`);
    manifest = await buildManifest({
      fromUnix,
      toUnix,
      stepSeconds: STEP,
      onRow: (r, i, total) => {
        if (i % 25 === 0 || i === total) log(`  ${i}/${total}  ${r.utc}  flare ${r.flareBlock}  xrpl ${r.xrplLedger}  skew ${r.skewSeconds}s`);
      },
    });
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    log(`→ ${MANIFEST}  (${manifest.length} slots)`);
  }

  const net = selectNetwork();
  const client = clientFor(net);
  const addrs = await resolveAddresses(client, net);
  log(`network ${net.label} · ${addrs.symbol} · core vault ${addrs.coreVaultManager}`);
  const rows: BackfillRow[] = [];
  for (const [i, h] of manifest.entries()) {
    const row = await evaluateRow(client, h, addrs);
    rows.push(row);
    if (i % 20 === 0 || i === manifest.length - 1) {
      log(`  ${i + 1}/${manifest.length}  ${row.utc}  ${row.opinion}${row.skewNote ? "  (skew)" : ""}`);
    }
  }

  const tally = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.opinion]: (a[r.opinion] ?? 0) + 1 }), {});
  const out = {
    generatedAt: new Date().toISOString(),
    derivation: "retrospective" as const,
    scope: SCOPE,
    scopeNote:
      "A BACKING series. C1 (outflow destination allowlist) needs a reconstructed transaction window " +
      "and is not evaluated here, so it is excluded from the rolled-up opinion rather than dragging " +
      "every row to DISCLAIMER. The claim is narrower than a full CV-1 period opinion, deliberately.",
    method:
      "CV-1 re-evaluated at historical heights. Every row is computed in retrospect and labelled as such. " +
      "Candidate exceptions are confirmed across a cross-chain skew bracket before being claimed.",
    xrplRetentionFloor: { ledger: XRPL_RETENTION_FLOOR, iso: XRPL_FLOOR_ISO },
    covenantBackfillable: false,
    covenantReason:
      "FDC attestation proofs expire at lutlimit (~14 days), so historical rounds cannot be re-proven at any price",
    slots: rows.length,
    tally,
    rows,
  };
  writeFileSync(SERIES, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  log("");
  log(`─── backfill · ${rows.length} slots ───`);
  for (const [k, v] of Object.entries(tally)) log(`  ${k.padEnd(11)} ${v}`);
  log(`  skew-suppressed exceptions: ${rows.filter((r) => r.skewNote).length}`);
  log(`→ ${SERIES}`);
}

main().catch((e: unknown) => {
  log(`backfill failed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});



