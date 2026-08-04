/**
 * Coston2 log access.
 *
 * Every public Coston2 RPC caps eth_getLogs, and they disagree wildly about
 * where: the official endpoint allows 30 blocks, Enosys 350, thirdweb 1000,
 * Ankr refuses without naming a number. A hardcoded chunk size is therefore
 * guaranteed to be either broken on one endpoint or needlessly slow on another,
 * so the limit is discovered at runtime and the fastest usable endpoint wins.
 *
 * Measured 2026-08-04; re-probed on every run because these are operational
 * settings that can change without notice.
 */
export interface Endpoint {
  url: string;
  maxRange: number;
}

const CANDIDATES = [
  "https://flare-testnet-coston2.rpc.thirdweb.com",
  "https://coston2.enosys.global/ext/C/rpc",
  "https://coston2-api.flare.network/ext/C/rpc",
] as const;

/** Ranges to try, largest first. The first that succeeds is adopted. */
const PROBE_RANGES = [10_000, 5_000, 1_000, 500, 350, 100, 30] as const;

/** Thrown when the endpoint is alive but refusing us — rate limits, quotas. */
export class ThrottledError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function rpcOnce(url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
    });

    // Rate limiters answer with plain text, not JSON-RPC. Parsing blindly here
    // produced `Unexpected token 'Y', "You are us"...` — useless at the call
    // site. Detect it and say what actually happened.
    const text = await res.text();
    if (!text.trimStart().startsWith("{") && !text.trimStart().startsWith("[")) {
      throw new ThrottledError(`${res.status} non-JSON from ${new URL(url).host}: ${text.slice(0, 120)}`);
    }
    if (res.status === 429) throw new ThrottledError(`429 from ${new URL(url).host}`);

    const body = JSON.parse(text) as { result?: unknown; error?: { message?: string; code?: number } };
    if (body.error) {
      const msg = body.error.message ?? "rpc error";
      if (/rate|limit|quota|too many requests/iu.test(msg)) throw new ThrottledError(msg);
      throw new Error(msg);
    }
    return body.result;
  } finally {
    clearTimeout(t);
  }
}

/** Retry with exponential backoff, but only for throttling and transport faults. */
async function rpc(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs = 25_000,
  attempts = 4,
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await rpcOnce(url, method, params, timeoutMs);
    } catch (e) {
      lastErr = e;
      // A range-too-large answer is a definitive "no" — retrying is pointless.
      if (e instanceof Error && /too many blocks|too large|exceeded/iu.test(e.message)) throw e;
      if (i < attempts - 1) await sleep(400 * 2 ** i + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

export async function blockNumber(url: string): Promise<bigint> {
  return BigInt((await rpc(url, "eth_blockNumber", [])) as string);
}

/** Find the largest eth_getLogs window an endpoint will actually serve. */
async function probeMaxRange(url: string, address: string, head: bigint): Promise<number> {
  for (const range of PROBE_RANGES) {
    try {
      await rpc(url, "eth_getLogs", [
        {
          address,
          fromBlock: `0x${(head - BigInt(range)).toString(16)}`,
          toBlock: `0x${head.toString(16)}`,
        },
      ]);
      return range;
    } catch {
      // too large (or endpoint unhappy) — try the next size down
    }
  }
  return 0;
}

/**
 * Rank every reachable endpoint by the widest log window it will serve.
 * Returns the full list, best first, so a long scan can fail over when one
 * endpoint starts throttling mid-run rather than dying at 60%.
 */
export async function rankEndpoints(address: string): Promise<Endpoint[]> {
  const results: Endpoint[] = [];
  for (const url of CANDIDATES) {
    try {
      const head = await blockNumber(url);
      const maxRange = await probeMaxRange(url, address, head);
      if (maxRange > 0) results.push({ url, maxRange });
    } catch {
      // endpoint unreachable — skip
    }
  }
  if (results.length === 0) throw new Error("no Coston2 RPC endpoint would serve eth_getLogs");
  return results.sort((a, b) => b.maxRange - a.maxRange);
}

export async function selectEndpoint(address: string): Promise<Endpoint> {
  return (await rankEndpoints(address))[0]!;
}

export interface RawLog {
  address: string;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: `0x${string}`;
  transactionHash: `0x${string}`;
}

export async function getLogs(
  ep: Endpoint,
  address: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawLog[]> {
  return (await rpc(ep.url, "eth_getLogs", [
    { address, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` },
  ])) as RawLog[];
}

/**
 * Sweep a block range, failing over to the next-best endpoint when one starts
 * refusing us. A long scan that dies at 60% and reports partial numbers is the
 * failure mode this exists to prevent — so if every endpoint rejects a chunk,
 * it throws rather than returning a hole.
 */
export async function sweepLogs(
  endpoints: readonly Endpoint[],
  address: string,
  fromBlock: bigint,
  toBlock: bigint,
  onProgress?: (pct: number, logs: number, via: string) => void,
): Promise<RawLog[]> {
  const pool = [...endpoints];
  let active = 0;
  const out: RawLog[] = [];
  const total = Number(toBlock - fromBlock) || 1;

  let f = fromBlock;
  while (f <= toBlock) {
    const ep = pool[active]!;
    const t = (() => {
      const end = f + BigInt(ep.maxRange) - 1n;
      return end > toBlock ? toBlock : end;
    })();

    try {
      out.push(...(await getLogs(ep, address, f, t)));
      onProgress?.((Number(t - fromBlock) / total) * 100, out.length, new URL(ep.url).host);
      f = t + 1n;
    } catch (e) {
      const next = active + 1;
      if (next >= pool.length) {
        throw new Error(
          `all ${pool.length} endpoints failed at blocks ${f}-${t}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      active = next;
      onProgress?.((Number(f - fromBlock) / total) * 100, out.length, `→ failover to ${new URL(pool[active]!.url).host}`);
    }
  }
  return out;
}
