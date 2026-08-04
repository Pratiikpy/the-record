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

const ENDPOINTS = [
  "https://s.altnet.rippletest.net:51234",
  "https://testnet.xrpl-labs.com",
] as const;

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
