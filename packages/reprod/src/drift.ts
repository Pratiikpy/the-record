/**
 * Drift — has the world moved since we last looked?
 *
 * The status badge measures AGE. Age is a proxy for staleness and it is a bad
 * one: a scan can be four hours old and already wrong, or four days old and
 * still exactly right. Ours published "223 machines" for twenty-nine hours
 * while the live registry held 250 — a headline figure 12% wrong, sitting
 * under a badge that reported itself fresh, because nothing ever compared the
 * snapshot to the chain.
 *
 * So this asks the only question that matters: does the published snapshot
 * still describe the registry? One cheap read, no full re-scan. It is the
 * `rot manifest` idea applied to the one dependency that actually moved —
 * every environmental assumption should be an observable control that
 * publishes its own breakage, rather than a stack trace nobody reads.
 *
 * It deliberately does NOT auto-refresh the snapshot. A register that silently
 * rewrites its own evidence when the world changes has no history, and the
 * drift itself is the finding.
 */
import { createPublicClient, http, defineChain } from "viem";

export const COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc";
export const TEE_MANAGER = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE" as const;

const coston2 = defineChain({
  id: 114,
  name: "Flare Coston2",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [COSTON2_RPC] } },
});

const abi = [
  {
    type: "function",
    name: "getAllActiveTeeMachines",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }, { type: "string[]" }, { type: "uint256" }],
  },
] as const;

export type DriftState =
  /** the snapshot still matches the registry */
  | "CURRENT"
  /** the registry has moved; the published figures no longer describe it */
  | "DRIFTED"
  /** the registry could not be read, so drift is unknown — never "current" */
  | "UNKNOWN";

export interface DriftReport {
  state: DriftState;
  snapshotTotal: number;
  liveTotal: number | null;
  /** machines added or removed since the snapshot */
  delta: number | null;
  checkedAt: string;
  because: string;
}

/**
 * Compare a published snapshot against the live registry.
 *
 * `UNKNOWN` rather than `CURRENT` on a read failure, for the same reason a
 * DISCLAIMER is never rolled up as a pass: not being able to check is not
 * evidence that nothing changed.
 */
export async function checkDrift(snapshotTotal: number, rpc = COSTON2_RPC): Promise<DriftReport> {
  const checkedAt = new Date().toISOString();
  const client = createPublicClient({ chain: coston2, transport: http(rpc) });

  let liveTotal: number | null = null;
  try {
    // The same one-machine probe the scanner uses to learn the total, so this
    // stays a single cheap read rather than a second full enumeration.
    const [, , total] = await client.readContract({
      address: TEE_MANAGER,
      abi,
      functionName: "getAllActiveTeeMachines",
      args: [0n, 1n],
    });
    liveTotal = Number(total);
  } catch (e) {
    return {
      state: "UNKNOWN",
      snapshotTotal,
      liveTotal: null,
      delta: null,
      checkedAt,
      because: `the registry could not be read (${e instanceof Error ? e.message.slice(0, 80) : "unknown error"}), so whether the snapshot still holds is unknown`,
    };
  }

  const delta = liveTotal - snapshotTotal;
  if (delta === 0) {
    return {
      state: "CURRENT",
      snapshotTotal,
      liveTotal,
      delta,
      checkedAt,
      because: `the registry holds ${liveTotal} machines, exactly what the snapshot describes`,
    };
  }

  return {
    state: "DRIFTED",
    snapshotTotal,
    liveTotal,
    delta,
    checkedAt,
    because:
      `the registry now holds ${liveTotal} machines but the published snapshot describes ${snapshotTotal} — ` +
      `${Math.abs(delta)} ${delta > 0 ? "added" : "removed"} since it was taken, so every figure derived from it is out of date`,
  };
}

/**
 * A drifted snapshot must not be published as though it were current.
 *
 * Returned rather than thrown so a caller can decide, but the intent is a
 * non-zero exit in CI: a register whose evidence has been overtaken by the
 * world is publishing history as if it were news.
 */
export function driftIsPublishable(r: DriftReport): boolean {
  return r.state === "CURRENT";
}
