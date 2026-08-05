/**
 * XRPL access for the Core Vault procedure.
 *
 * The Core Vault is a Flare-governed multisig ON XRPL, manually operated by
 * human signers in daily windows. Its address, its custodian, and its allowed
 * destinations are all public on Flare; its actual payments are all public on
 * XRPL. So the whole control test runs on public data with no cooperation from
 * anyone — which is the only kind of assurance that starts without permission.
 */
export interface XrplTx {
  hash: string;
  type: string;
  destination?: string;
  destinationTag?: number;
  amountDrops?: string;
  account: string;
  ledgerIndex: number;
  date?: number;
  successful: boolean;
}

/**
 * Which XRPL cluster backs the Flare network under test.
 *
 * FAssets on Flare mainnet are backed by real XRP on the XRP Ledger mainnet;
 * on Coston2 they are backed by testnet XRP. Reading the wrong cluster would
 * reconcile Flare's accounting against a completely unrelated ledger and
 * produce a confident, meaningless verdict -- so the endpoints follow the
 * network rather than being fixed.
 */
const MAINNET_ENDPOINTS = ["https://xrplcluster.com", "https://s2.ripple.com:51234"] as const;
const TESTNET_ENDPOINTS = ["https://s.altnet.rippletest.net:51234", "https://testnet.xrpl-labs.com"] as const;

const ENDPOINTS: readonly string[] =
  (process.env.NETWORK ?? "flare").toLowerCase() === "coston2" ? TESTNET_ENDPOINTS : MAINNET_ENDPOINTS;

/** XRPL epoch is 2000-01-01T00:00:00Z, 946684800s after the Unix epoch. */
export const XRPL_EPOCH_OFFSET = 946_684_800;

export function xrplTimeToUnix(rippleSeconds: number): number {
  return rippleSeconds + XRPL_EPOCH_OFFSET;
}

async function rpc(url: string, body: unknown, timeoutMs = 25_000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!text.trimStart().startsWith("{")) {
      throw new Error(`non-JSON from ${new URL(url).host}: ${text.slice(0, 120)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

interface AccountTxResult {
  result?: {
    status?: string;
    transactions?: Array<{
      tx?: Record<string, unknown>;
      tx_json?: Record<string, unknown>;
      meta?: { TransactionResult?: string } | string;
      validated?: boolean;
      hash?: string;
      ledger_index?: number;
      close_time_iso?: string;
    }>;
    marker?: unknown;
  };
}

/**
 * Normalise one XRPL transaction envelope.
 *
 * rippled has shipped several shapes for this (`tx` vs `tx_json`, hash at the
 * envelope vs inside), so both are read. Getting this wrong silently yields
 * zero transactions and a control that trivially "passes" — the same failure
 * mode as the uint64 event bug, and just as invisible.
 */
function normalise(entry: NonNullable<NonNullable<AccountTxResult["result"]>["transactions"]>[number]): XrplTx | null {
  const tx = entry.tx ?? entry.tx_json;
  if (!tx) return null;

  const meta = entry.meta;
  const code = typeof meta === "string" ? undefined : meta?.TransactionResult;
  const amount = tx.Amount ?? tx.DeliverMax;

  return {
    hash: String(entry.hash ?? tx.hash ?? ""),
    type: String(tx.TransactionType ?? "UNKNOWN"),
    destination: typeof tx.Destination === "string" ? tx.Destination : undefined,
    destinationTag: typeof tx.DestinationTag === "number" ? tx.DestinationTag : undefined,
    amountDrops: typeof amount === "string" ? amount : undefined,
    account: String(tx.Account ?? ""),
    ledgerIndex: Number(entry.ledger_index ?? tx.ledger_index ?? 0),
    date: typeof tx.date === "number" ? xrplTimeToUnix(tx.date) : undefined,
    // Only tesSUCCESS actually moved value. Anything else must not be counted
    // as an outflow, or a failed payment would be scored as a control breach.
    successful: code === "tesSUCCESS",
  };
}

/** One XRPL Escrow ledger object owned by the account. */
export interface XrplEscrow {
  index: string;
  /** drops, as a string — only XRP escrows have a string Amount */
  amountDrops: string;
  destination?: string;
  cancelAfter?: number;
  /** crypto-condition; the Core Vault's escrows are all PREIMAGE-SHA256 */
  condition?: string;
}

/**
 * What the XRP Ledger itself says about the account.
 *
 * This is the only evidence in CV-1 that Flare does not produce. Every other
 * number — available, escrowed, total — originates from the same Flare
 * contracts, so reconciling them against each other proves nothing. The red run
 * demonstrated exactly that: corrupting `escrowedFunds` moved both sides of the
 * old C3 identity together and the control stayed green.
 *
 * A reconciliation needs two independent sources. This is the second one.
 */
export interface XrplAccountState {
  /** account_data.Balance — LIQUID drops only; escrowed XRP is not in here */
  balanceDrops: bigint;
  /** number of ledger objects the account owns, which sets its reserve */
  ownerCount: number;
  /** base + owner reserve, in drops, read from the ledger rather than assumed */
  reserveDrops: bigint;
  escrows: XrplEscrow[];
  /**
   * Escrow objects whose Amount is not a plain drops string — an IOU or MPT
   * escrow under a newer amendment. Counting these as zero would understate
   * what the ledger holds and manufacture a shortfall, so they are surfaced and
   * the control disclaims rather than guessing.
   */
  nonXrpEscrows: number;
}

async function firstEndpoint<T>(fn: (url: string) => Promise<T>, what: string, account: string): Promise<T> {
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      return await fn(url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `no XRPL endpoint served ${what} for ${account}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * Read balance, reserve and every escrow object in one consistent snapshot.
 *
 * Pinned to a single validated ledger index: balance and escrows must be read
 * at the same instant or an escrow finishing between the two calls would look
 * like a shortfall. Pagination is followed to exhaustion — stopping at a marker
 * would undercount escrowed XRP and produce exactly the kind of false
 * accusation this procedure has already made twice.
 */
export async function accountLedgerState(account: string): Promise<XrplAccountState> {
  return firstEndpoint(
    async (url) => {
      const state = (await rpc(url, { method: "server_state", params: [{}] })) as {
        result?: { state?: { validated_ledger?: { seq?: number; reserve_base?: number; reserve_inc?: number } } };
      };
      const vl = state.result?.state?.validated_ledger;
      if (!vl || typeof vl.seq !== "number" || typeof vl.reserve_base !== "number" || typeof vl.reserve_inc !== "number") {
        throw new Error("server_state did not report a validated ledger with reserves");
      }
      const ledgerIndex = vl.seq;

      const info = (await rpc(url, {
        method: "account_info",
        params: [{ account, ledger_index: ledgerIndex }],
      })) as { result?: { account_data?: { Balance?: string; OwnerCount?: number }; status?: string } };
      const bal = info.result?.account_data?.Balance;
      const ownerCount = info.result?.account_data?.OwnerCount;
      if (typeof bal !== "string" || typeof ownerCount !== "number") {
        throw new Error(`account_info gave no balance/OwnerCount (status ${info.result?.status})`);
      }

      const escrows: XrplEscrow[] = [];
      let nonXrpEscrows = 0;
      let marker: unknown = undefined;
      for (let page = 0; page < 50; page++) {
        const objs = (await rpc(url, {
          method: "account_objects",
          params: [
            { account, ledger_index: ledgerIndex, type: "escrow", limit: 400, ...(marker === undefined ? {} : { marker }) },
          ],
        })) as {
          result?: {
            account_objects?: Array<Record<string, unknown>>;
            marker?: unknown;
            status?: string;
          };
        };
        if (objs.result?.status !== "success") throw new Error(`account_objects status ${objs.result?.status}`);
        for (const o of objs.result.account_objects ?? []) {
          if (typeof o.Amount !== "string") {
            nonXrpEscrows++;
            continue;
          }
          escrows.push({
            index: String(o.index ?? ""),
            amountDrops: o.Amount,
            destination: typeof o.Destination === "string" ? o.Destination : undefined,
            cancelAfter: typeof o.CancelAfter === "number" ? o.CancelAfter : undefined,
            condition: typeof o.Condition === "string" ? o.Condition : undefined,
          });
        }
        marker = objs.result.marker;
        if (marker === undefined || marker === null) {
          return {
            balanceDrops: BigInt(bal),
            ownerCount,
            reserveDrops: BigInt(vl.reserve_base) + BigInt(vl.reserve_inc) * BigInt(ownerCount),
            escrows,
            nonXrpEscrows,
          };
        }
      }
      throw new Error("account_objects did not terminate within 50 pages");
    },
    "ledger state",
    account,
  );
}

/** Total XRP held in the account's escrow objects, in drops. */
export function totalEscrowedDrops(escrows: readonly XrplEscrow[]): bigint {
  return escrows.reduce((sum, e) => sum + BigInt(e.amountDrops), 0n);
}

/** Fetch recent transactions for an account, newest first. */
export async function accountTx(account: string, limit = 200): Promise<XrplTx[]> {
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      const body = {
        method: "account_tx",
        params: [{ account, limit, ledger_index_min: -1, ledger_index_max: -1, binary: false }],
      };
      const r = (await rpc(url, body)) as AccountTxResult;
      if (r.result?.status !== "success") throw new Error(`status ${r.result?.status}`);
      const txs = (r.result.transactions ?? []).map(normalise).filter((x): x is XrplTx => x !== null);
      if (txs.length === 0 && (r.result.transactions ?? []).length > 0) {
        // Envelopes came back but none decoded — a shape change, not an empty
        // account. Fail loudly rather than report a clean control run.
        throw new Error("account_tx returned envelopes that could not be decoded");
      }
      return txs;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `no XRPL endpoint served account_tx for ${account}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
