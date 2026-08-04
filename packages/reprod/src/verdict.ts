/**
 * Verdict classification. Pure functions — no I/O — so every branch is unit-testable.
 *
 * Two independent axes, deliberately never collapsed into one badge:
 *
 *   attestation — what the chain says this machine's code IS
 *   liveness    — whether the machine is actually reachable right now
 *
 * A machine can be perfectly attested and completely dead. Conflating those
 * would hide the single most common failure in FCC today (a registered URL
 * that no longer resolves), so they stay separate all the way to the UI.
 */
import { SIMULATED_CODE_HASH_PREFIX, bytes32ToString } from "./chain.js";

export type Attestation =
  | "REPRODUCED"       // rebuilt from declared source; config digest matches on-chain codeHash
  | "DIVERGED"         // rebuilt; digest does NOT match
  | "UNREPRODUCIBLE"   // declared source exists but cannot build deterministically
  | "SIMULATED"        // attested to a simulator — binds to no source code at all
  | "NO_KNOWN_SOURCE"; // nobody has claimed a source revision for this code hash

export type Liveness = "LIVE" | "DEAD" | "UNCHECKED";

export const ATTESTATION_ORDER: Attestation[] = [
  "DIVERGED",
  "SIMULATED",
  "UNREPRODUCIBLE",
  "NO_KNOWN_SOURCE",
  "REPRODUCED",
];

/** Platforms that are not real confidential hardware. */
const SIMULATED_PLATFORMS = new Set(["TEST_PLATFORM", ""]);

export interface SourceClaim {
  /** e.g. "flare-foundation/fce-sign" */
  repo: string;
  /** immutable commit sha, resolved via FDC Web2Json — never a mutable tag */
  commitSha: string;
  /** result of an actual rebuild, if one has been attempted */
  rebuild?: { digest: string; deterministic: boolean };
}

export interface MachineFacts {
  codeHash: string;
  /** raw bytes32 platform from getTeeMachineWithAttestationData */
  platformRaw: string;
  claim?: SourceClaim;
}

/**
 * Classify a machine's attestation.
 *
 * Order matters. SIMULATED is checked before any source comparison because a
 * simulated code hash is a constant that every simulated machine shares — it
 * would "reproduce" against anything and mean nothing.
 */
export function classifyAttestation(f: MachineFacts): Attestation {
  const platform = bytes32ToString(f.platformRaw as `0x${string}`);

  if (SIMULATED_PLATFORMS.has(platform)) return "SIMULATED";
  if (f.codeHash.toLowerCase().startsWith(SIMULATED_CODE_HASH_PREFIX)) return "SIMULATED";

  if (!f.claim) return "NO_KNOWN_SOURCE";
  if (!f.claim.rebuild) return "NO_KNOWN_SOURCE";
  if (!f.claim.rebuild.deterministic) return "UNREPRODUCIBLE";

  return f.claim.rebuild.digest.toLowerCase() === f.codeHash.toLowerCase()
    ? "REPRODUCED"
    : "DIVERGED";
}

/**
 * URL hosts whose addresses are ephemeral by construction. Registering one of
 * these means the machine's on-chain URL is expected to rot — which is exactly
 * why this is surfaced rather than silently folded into "DEAD".
 */
const EPHEMERAL_HOST_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.trycloudflare\.com$/iu, "cloudflare quick tunnel — new URL every run"],
  [/\.ngrok-free\.(dev|app)$/iu, "ngrok free tunnel — URL rotates"],
  [/\.ngrok\.io$/iu, "ngrok tunnel — URL rotates"],
  [/\.app\.github\.dev$/iu, "GitHub Codespaces — dies with the codespace"],
  [/\.up\.railway\.app$/iu, "Railway ephemeral deploy"],
  [/\.loca\.lt$/iu, "localtunnel — URL rotates"],
];

export interface UrlAssessment {
  host: string;
  ephemeral: boolean;
  reason?: string;
  /** plain http:// to a raw IP — the proxy is exposed unencrypted */
  insecure: boolean;
}

export function assessUrl(raw: string): UrlAssessment {
  let host: string;
  let protocol: string;
  try {
    const u = new URL(raw);
    host = u.hostname;
    protocol = u.protocol;
  } catch {
    return { host: raw, ephemeral: false, insecure: false };
  }

  for (const [pattern, reason] of EPHEMERAL_HOST_PATTERNS) {
    if (pattern.test(host)) return { host, ephemeral: true, reason, insecure: protocol === "http:" };
  }
  return { host, ephemeral: false, insecure: protocol === "http:" };
}

/**
 * Rank a fleet by how much attention it needs. Lower sorts first.
 *
 * Diverged-and-live is the most alarming state in the system: a machine
 * actively serving from code nobody can reproduce.
 *
 * Note that SIMULATED outranks nothing. A simulated machine is someone
 * developing — legitimate, expected, and not evidence of anything. On Coston2
 * it is also the overwhelming majority, so ranking it above real hardware
 * buries the only rows that carry weight. Because `classifyAttestation` returns
 * SIMULATED before it ever considers a source claim, any other verdict implies
 * real confidential hardware, and those come first.
 */
export function severity(a: Attestation, l: Liveness): number {
  const live = l === "LIVE";
  switch (a) {
    case "DIVERGED":
      return live ? 0 : 1;
    case "UNREPRODUCIBLE":
      return live ? 2 : 3;
    case "NO_KNOWN_SOURCE":
      return live ? 4 : 5;
    case "REPRODUCED":
      return live ? 6 : 7;
    case "SIMULATED":
      return live ? 8 : 9;
  }
}
