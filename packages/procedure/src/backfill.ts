/**
 * Backfill — history is a property of the chain, not of when you started.
 *
 * A continuous-assurance register is usually assumed to have a warm-up period:
 * you deploy a cron, and a year later you have a year of history. But CV-1 is a
 * pure function of chain state at a height. If that is true, then the opinion
 * for every past height already exists — it has merely never been evaluated.
 * So the register does not need to wait. It needs to compute.
 *
 * This module resolves the heights and nothing else. Deliberately: the height
 * manifest is a factual artifact with no opinion in it, independently
 * re-derivable, and it makes the load-bearing risk — cross-chain skew — a
 * measured column *before* a single verdict is computed on top of it.
 *
 * ── WHAT IS AND IS NOT BACKFILLABLE ────────────────────────────────────────
 *
 * PROCEDURE (CV-1) — yes. Every input is state at a height: Coston2 serves
 * archive `eth_call` (verified back past block 30,000,000), and XRPL testnet
 * serves `account_objects` at historical ledgers down to a retention floor.
 *
 * COVENANT — no. FDC attestation proofs expire at `lutlimit` (~14 days), so a
 * proof for an old round cannot be obtained at any price. That layer is
 * genuinely un-backfillable and the record must say so in its own column
 * rather than quietly omitting it.
 *
 * ── ON HONESTY ─────────────────────────────────────────────────────────────
 *
 * Every backfilled row is labelled `retrospective`. It is exactly as
 * re-derivable as a live row — same heights, same digest — but it was not
 * published contemporaneously, and presenting it as though it had been would
 * be a lie of exactly the kind this project exists not to tell.
 */
import { createPublicClient, http, defineChain, type PublicClient } from "viem";

/** Verified 2026-08-04: the oldest XRPL testnet ledger the public cluster served. */
export const XRPL_RETENTION_FLOOR = 13_078_125;
export const XRPL_FLOOR_ISO = "2025-12-10T07:28:52Z";

/** XRPL ledgers close about every 4 seconds; used only to seed a search. */
const XRPL_LEDGER_SECONDS = 4;
/** Flare blocks are ~1.8s on Coston2; likewise only a seed. */
const FLARE_BLOCK_SECONDS = 1.8;

export interface HeightRow {
  /** the UTC instant this row samples */
  utc: string;
  unix: number;
  flareBlock: number;
  flareUnix: number;
  xrplLedger: number;
  xrplUnix: number;
  /**
   * How far apart the two chains actually were, in seconds.
   *
   * This is the number that decides whether a mismatch is a finding or an
   * artifact. A live cron reads both chains once and never second-guesses the
   * gap; a backfill re-runs that ambiguity hundreds of times, so it has to
   * publish the gap rather than hope it is small.
   */
  skewSeconds: number;
}

export const coston2 = defineChain({
  id: 114,
  name: "Flare Coston2",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
});

export function makeClient(rpc?: string): PublicClient {
  const url = rpc ?? "https://coston2-api.flare.network/ext/C/rpc";
  return createPublicClient({ chain: coston2, transport: http(url) }) as PublicClient;
}

/**
 * The last Flare block at or before `unix`.
 *
 * Binary search rather than timestamp arithmetic: block times drift, and a
 * seeded guess that is merely close would silently sample the wrong side of a
 * state transition — which is exactly how a backfill manufactures findings.
 */
export async function flareBlockAtTime(
  client: PublicClient,
  unix: number,
  hint?: { lo: number; hi: number },
): Promise<{ block: number; unix: number }> {
  let lo = hint?.lo ?? 1;
  let hi = hint?.hi ?? Number(await client.getBlockNumber());

  const tsAt = async (n: number): Promise<number> =>
    Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp);

  if ((await tsAt(lo)) > unix) throw new Error(`no Flare block at or before ${new Date(unix * 1000).toISOString()}`);

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((await tsAt(mid)) <= unix) lo = mid;
    else hi = mid - 1;
  }
  return { block: lo, unix: await tsAt(lo) };
}

const XRPL_ENDPOINTS = ["https://s.altnet.rippletest.net:51234", "https://testnet.xrpl-labs.com"] as const;

async function xrplRpc(body: unknown, attempts = 3): Promise<Record<string, unknown>> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    for (const url of XRPL_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25_000),
        });
        const text = await res.text();
        if (!text.trimStart().startsWith("{")) throw new Error(`non-JSON from ${new URL(url).host}`);
        return JSON.parse(text) as Record<string, unknown>;
      } catch (e) {
        last = e;
      }
    }
  }
  throw new Error(`XRPL RPC failed after ${attempts} rounds: ${last instanceof Error ? last.message : String(last)}`);
}

/**
 * Close time of an XRPL ledger, or null when no node retained it.
 *
 * The public cluster is load-balanced across nodes with different retention,
 * so a single `lgrNotFound` is not proof of absence — it is retried across
 * endpoints before being believed. Treating one miss as authoritative would
 * put a hole in the record that the chain does not actually have.
 */
export async function xrplLedgerCloseTime(index: number): Promise<number | null> {
  const r = (await xrplRpc({ method: "ledger", params: [{ ledger_index: index }] })) as {
    result?: { status?: string; ledger?: { close_time?: number; close_time_iso?: string } };
  };
  if (r.result?.status !== "success") return null;
  const iso = r.result.ledger?.close_time_iso;
  if (typeof iso === "string") return Math.floor(Date.parse(iso) / 1000);
  const ct = r.result.ledger?.close_time;
  return typeof ct === "number" ? ct + 946_684_800 : null;
}

/** The validated ledger index at the tip. */
export async function xrplTipLedger(): Promise<number> {
  const r = (await xrplRpc({ method: "ledger", params: [{ ledger_index: "validated" }] })) as {
    result?: { ledger_index?: number; ledger?: { ledger_index?: number | string } };
  };
  const idx = r.result?.ledger_index ?? Number(r.result?.ledger?.ledger_index);
  if (!Number.isFinite(idx)) throw new Error("could not read the validated XRPL ledger index");
  return Number(idx);
}

/**
 * The last XRPL ledger closing at or before `unix`.
 *
 * Seeded from the tip by ledger-time arithmetic and then binary searched, with
 * unretained probes skipped rather than treated as boundaries — a pruned
 * ledger says nothing about where the target is.
 */
export async function xrplLedgerAtTime(
  unix: number,
  tip: { index: number; unix: number },
  floor = XRPL_RETENTION_FLOOR,
): Promise<{ ledger: number; unix: number } | null> {
  const guess = tip.index - Math.round((tip.unix - unix) / XRPL_LEDGER_SECONDS);

  // The seed assumes a 4s ledger interval, but the real rate drifts. Over ten
  // days that error compounds past any fixed window, so the search widens
  // rather than giving up — an early version used a flat ±20,000 and silently
  // returned null for every slot more than about a week old, which looked like
  // XRPL retention and was actually a seeding bug.
  const windows = [20_000, 120_000, Number.POSITIVE_INFINITY];

  for (const w of windows) {
    let lo = Number.isFinite(w) ? Math.max(floor, guess - w) : floor;
    let hi = Number.isFinite(w) ? Math.min(tip.index, guess + w) : tip.index;
    if (lo > hi) continue;

    let best: { ledger: number; unix: number } | null = null;
    let sawAny = false;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = await xrplLedgerCloseTime(mid);
      if (t === null) {
        // Not retained on any endpoint. Step inward rather than concluding.
        if (mid === lo) lo = mid + 1;
        else hi = mid - 1;
        continue;
      }
      sawAny = true;
      if (t <= unix) {
        best = { ledger: mid, unix: t };
        lo = mid + 1;
      } else hi = mid - 1;
    }

    // A hit whose close time is within a ledger-interval of the target is the
    // answer. A hit far from the target means the window was on the wrong side
    // of the drift, so widen instead of returning a badly-skewed pair.
    if (best && Math.abs(best.unix - unix) <= XRPL_LEDGER_SECONDS * 4) return best;
    if (best && !Number.isFinite(w)) return best;
    if (!sawAny && !Number.isFinite(w)) return null;
  }
  return null;
}

export interface ManifestOptions {
  fromUnix: number;
  toUnix: number;
  /** sampling period; 6h matches the cadence a live register would run at */
  stepSeconds: number;
  rpc?: string;
  onRow?: (row: HeightRow, i: number, total: number) => void;
}

/**
 * Resolve one (Flare block, XRPL ledger) pair per sampling slot.
 *
 * Emits facts only. No verdict logic runs here and none may: the manifest has
 * to be checkable on its own, so that a disagreement about an opinion can
 * never be confused with a disagreement about which heights were read.
 */
export async function buildManifest(opts: ManifestOptions): Promise<HeightRow[]> {
  const client = makeClient(opts.rpc);
  const tipBlock = Number(await client.getBlockNumber());
  const tipIndex = await xrplTipLedger();
  const tipTime = await xrplLedgerCloseTime(tipIndex);
  if (tipTime === null) throw new Error("could not read the XRPL tip close time");

  const slots: number[] = [];
  for (let t = opts.fromUnix; t <= opts.toUnix; t += opts.stepSeconds) slots.push(t);

  const rows: HeightRow[] = [];
  let hi = tipBlock;

  // Walk newest → oldest so each search can bound itself by the previous
  // answer; one pass over the chain instead of a full search per slot.
  for (let i = slots.length - 1; i >= 0; i--) {
    const unix = slots[i]!;
    const f = await flareBlockAtTime(client, unix, { lo: 1, hi });
    hi = f.block;
    const x = await xrplLedgerAtTime(unix, { index: tipIndex, unix: tipTime });
    if (!x) continue; // below the retention floor — handled as a disclaimer, not a gap

    const row: HeightRow = {
      utc: new Date(unix * 1000).toISOString(),
      unix,
      flareBlock: f.block,
      flareUnix: f.unix,
      xrplLedger: x.ledger,
      xrplUnix: x.unix,
      skewSeconds: Math.abs(f.unix - x.unix),
    };
    rows.push(row);
    opts.onRow?.(row, slots.length - i, slots.length);
  }

  return rows.reverse();
}
