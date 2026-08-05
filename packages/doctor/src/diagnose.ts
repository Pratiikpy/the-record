/**
 * doctor — why is this TEE machine not working?
 *
 * most registered machines on Coston2 are unreachable, and FCC's failure
 * modes are documented as silent: a machine sits at INITIALIZED forever, or
 * instructions simply never arrive, with no error surface anywhere.
 *
 * ARCHITECTURE, AND IT MATTERS:
 *
 *   The diagnosis is deterministic. Every finding below is a rule over facts
 *   read from the chain and from a live probe. That is the product.
 *
 *   The prose explanation (see explain.ts) is a convenience layer that only
 *   PHRASES those findings. It may not add, infer or soften anything, and the
 *   tool works completely without it. A diagnostic that quietly depends on a
 *   language model for its conclusions is not a diagnostic.
 */

export type Severity = "BLOCKER" | "WARNING" | "NOTE";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** the observed fact, stated plainly */
  observed: string;
  /** what to actually do — omitted when we genuinely do not know */
  fix?: string;
  /** where this rule comes from, so a reader can check it */
  source?: string;
}

export interface MachineFacts {
  teeId: string;
  extensionId: string;
  status: string;
  codeHash: string;
  platform: string;
  url: string;
  host: string;
  ephemeral: boolean;
  ephemeralReason?: string;
  insecure: boolean;
  machinesOnThisUrl: number;
  liveness: "LIVE" | "DEAD" | "UNCHECKED";
  probeStatus?: number;
  probeError?: string;
  probeMs?: number;
  selfReportedCodeHash?: string;
  selfReport: "MATCHES" | "MISMATCH" | "AMBIGUOUS" | "NONE";
}

/** The documented simulated code hash. Attested, but bound to no source. */
export const SIMULATED_CODE_HASH_PREFIX = "0x194844cf";

export function diagnose(m: MachineFacts): Finding[] {
  const f: Finding[] = [];

  // ---- reachability, the single most common failure --------------------------
  if (m.liveness === "DEAD") {
    if (m.ephemeral) {
      f.push({
        id: "URL_ROTATED",
        severity: "BLOCKER",
        title: "The registered URL belongs to a tunnel that has moved",
        observed: `${m.host} did not answer${m.probeError ? ` (${m.probeError})` : ""}. ${m.ephemeralReason ?? "This host rotates its address."}`,
        fix: "Restart the tunnel, then re-register the machine with the new URL. A quick tunnel issues a different address every run, so the on-chain URL goes stale the moment the tunnel restarts.",
        source: "FCC troubleshooting: a registered URL that no longer works is the top cause of machines that never receive instructions",
      });
    } else {
      f.push({
        id: "PROXY_UNREACHABLE",
        severity: "BLOCKER",
        title: "The proxy did not answer",
        observed: `GET ${m.url}/info failed${m.probeError ? `: ${m.probeError}` : m.probeStatus ? ` with HTTP ${m.probeStatus}` : ""}.`,
        fix: "Check the ext-proxy container is running and that port 6674 is actually exposed at this address. Data providers can only reach the machine through this URL.",
      });
    }
  }

  if (m.liveness === "LIVE" && m.probeMs !== undefined && m.probeMs > 1000) {
    f.push({
      id: "SLOW_PROXY",
      severity: "NOTE",
      title: "The proxy is slow to respond",
      observed: `/info took ${m.probeMs} ms.`,
      fix: "Not a fault on its own, but a proxy this slow may miss instruction relays under load.",
    });
  }

  // ---- attestation -----------------------------------------------------------
  if (m.codeHash.toLowerCase().startsWith(SIMULATED_CODE_HASH_PREFIX) || m.platform === "TEST_PLATFORM") {
    f.push({
      id: "SIMULATED",
      severity: "NOTE",
      title: "This machine is attested to a simulator",
      observed: `platform ${m.platform || "(unset)"}, code hash ${m.codeHash.slice(0, 12)}… — the shared simulated constant.`,
      fix: "Expected while developing with SIMULATED_TEE=true. It binds to no source code, so nothing about this machine's code can be verified by anyone. Move to a confidential VM before treating its signatures as evidence.",
    });
  }

  // ---- registration status ---------------------------------------------------
  if (m.status === "INITIALIZED") {
    f.push({
      id: "NEVER_REACHED_PRODUCTION",
      severity: "BLOCKER",
      title: "Registered but never promoted to PRODUCTION",
      observed: "status is INITIALIZED.",
      fix: "The availability check never completed. It polls the proxy URL, so this almost always resolves to the same cause as an unreachable proxy — fix reachability first, then re-run post-build.",
    });
  }
  if (m.status === "PAUSED" || m.status === "BANNED") {
    f.push({
      id: "SUSPENDED",
      severity: "BLOCKER",
      title: `Machine is ${m.status}`,
      observed: `on-chain status is ${m.status}.`,
      fix: "A suspended machine receives no instructions regardless of whether its proxy answers.",
    });
  }

  // ---- transport -------------------------------------------------------------
  if (m.insecure) {
    f.push({
      id: "PLAINTEXT_PROXY",
      severity: "WARNING",
      title: "The proxy is served over plain http://",
      observed: `${m.url} is unencrypted.`,
      fix: "Instructions and results cross this link. Terminate TLS in front of the proxy, or tunnel it.",
    });
  }

  // ---- identity --------------------------------------------------------------
  if (m.selfReport === "MISMATCH") {
    f.push({
      id: "SELF_REPORT_MISMATCH",
      severity: "BLOCKER",
      title: "The proxy reports a different code hash than the chain has",
      observed: `chain ${m.codeHash.slice(0, 14)}…, proxy ${(m.selfReportedCodeHash ?? "").slice(0, 14)}…`,
      fix: "The running image is not the one registered. Re-register the current version, or redeploy the registered one — signatures from this machine will not verify against what consumers expect.",
    });
  }
  if (m.selfReport === "AMBIGUOUS") {
    f.push({
      id: "SHARED_PROXY",
      severity: "NOTE",
      title: "Several machines share this proxy URL",
      observed: `${m.machinesOnThisUrl} machines are registered at ${m.host}.`,
      fix: "Not a fault. But the proxy serves one /info, so its self-reported code hash cannot be attributed to any single machine — no drift check is possible here.",
    });
  }

  if (f.length === 0) {
    f.push({
      id: "HEALTHY",
      severity: "NOTE",
      title: "No faults found",
      observed: `${m.host} answered in ${m.probeMs ?? "?"} ms, status ${m.status}, platform ${m.platform}.`,
    });
  }

  const rank: Record<Severity, number> = { BLOCKER: 0, WARNING: 1, NOTE: 2 };
  return f.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function verdictOf(findings: readonly Finding[]): Severity | "OK" {
  if (findings.some((x) => x.severity === "BLOCKER")) return "BLOCKER";
  if (findings.some((x) => x.severity === "WARNING")) return "WARNING";
  if (findings.every((x) => x.id === "HEALTHY")) return "OK";
  return "NOTE";
}
