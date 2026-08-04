/**
 * Liveness probing for TEE proxies.
 *
 * The proxy exposes GET /info. A machine registered on-chain with a URL that no
 * longer resolves is the documented #1 cause of "instructions never arrive" —
 * so this is the single highest-value read in the whole scanner.
 *
 * Probing is deduplicated by URL (hundreds of machines share a handful of
 * tunnels), bounded in concurrency, and hard-timeout'd. We never follow
 * redirects to somewhere else and we never send credentials.
 */
export interface ProbeResult {
  url: string;
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
  /** codeHash the proxy reports about ITSELF — untrusted, for comparison only */
  selfReportedCodeHash?: string;
  extensionId?: string;
}

const PROBE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 12;

async function probeOne(url: string): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(new URL("/info", url).toString(), {
      signal: controller.signal,
      redirect: "manual",
      headers: { accept: "application/json", "user-agent": "the-record/reprod (+liveness probe)" },
    });
    const ms = Date.now() - started;

    if (!res.ok) return { url, ok: false, status: res.status, ms };

    let selfReportedCodeHash: string | undefined;
    let extensionId: string | undefined;
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const md = (body.machineData ?? body) as Record<string, unknown>;
      const ch = md.codeHash;
      const ex = md.extensionId;
      if (typeof ch === "string") selfReportedCodeHash = ch;
      if (typeof ex === "string" || typeof ex === "number") extensionId = String(ex);
    } catch {
      // A 200 that isn't JSON still proves the host is up; that is all we claim.
    }

    return { url, ok: true, status: res.status, ms, selfReportedCodeHash, extensionId };
  } catch (err) {
    const ms = Date.now() - started;
    const error = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err);
    return { url, ok: false, ms, error };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe a set of URLs with bounded concurrency. Returns a map keyed by URL. */
export async function probeAll(
  urls: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ProbeResult>> {
  const unique = [...new Set(urls)];
  const out = new Map<string, ProbeResult>();
  let done = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= unique.length) return;
      const url = unique[i]!;
      out.set(url, await probeOne(url));
      onProgress?.(++done, unique.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return out;
}
