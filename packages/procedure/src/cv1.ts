/**
 * Procedure CV-1 — Core Vault outflow controls.
 *
 * The FAssets Core Vault is a Flare-governed multisig on XRPL, manually
 * operated by human signers in daily windows with a Red Alert Mode. It is the
 * single most audit-relevant surface in the whole stack, and there is currently
 * no record of whether its documented controls actually hold.
 *
 * Every input is public: the allowlist, custodian and fund balances come from
 * Flare, the payments come from XRPL. So this procedure needs no client, no
 * credentials and nobody's permission to run — which is exactly the wedge that
 * makes continuous assurance startable at all.
 *
 * The opinion vocabulary is deliberately an auditor's, not a dashboard's:
 * CLEAN, EXCEPTION, DISCLAIMER. A procedure that can only produce good news is
 * marketing, so DISCLAIMER — "I could not obtain enough evidence to conclude" —
 * is a first-class outcome and is never silently upgraded to CLEAN.
 */
import type { XrplTx } from "./xrpl.js";

export type Opinion = "CLEAN" | "EXCEPTION" | "DISCLAIMER";

export interface ControlResult {
  id: string;
  title: string;
  /** what the control asserts, in the auditor's words */
  assertion: string;
  opinion: Opinion;
  tested: number;
  exceptions: string[];
  /** why no conclusion was possible, when opinion is DISCLAIMER */
  disclaimer?: string;
  /** a disclosed quantity that is not itself pass/fail */
  observation?: string;
}

export interface CoreVaultState {
  coreVaultAddress: string;
  custodianAddress: string;
  allowedDestinations: string[];
  /** CoreVaultManager.availableFunds() — the manager's raw balance */
  availableFundsUBA: string;
  /** CoreVaultManager.escrowedFunds() */
  escrowedFundsUBA: string;
  /** AssetManager.coreVaultAvailableAmount().immediatelyAvailableUBA */
  immediatelyAvailableUBA?: string;
  /** AssetManager.coreVaultAvailableAmount().totalAvailableUBA */
  reportedTotalUBA?: string;
}

export interface Cv1Report {
  procedureId: "CV-1";
  /** the day under test, UTC */
  period: string;
  state: CoreVaultState;
  controls: ControlResult[];
  opinion: Opinion;
  evidence: {
    xrplTransactions: number;
    outflows: number;
    ledgerRange: [number, number] | null;
    /** digest of the exact evidence considered, so a re-run is comparable */
    evidenceDigest: string;
  };
}

/** Outflows are successful Payments SENT BY the vault. */
export function outflowsOf(txs: readonly XrplTx[], vault: string): XrplTx[] {
  return txs.filter((t) => t.successful && t.type === "Payment" && t.account === vault);
}

/**
 * C1 — every outflow lands on an address that was permitted to receive it.
 *
 * The allowlist is read from Flare at test time. The custodian is permitted by
 * construction: it is the vault's own designated counterparty and appears
 * separately in `custodianAddress`, not in the destination allowlist.
 */
export function controlAllowlist(outflows: readonly XrplTx[], s: CoreVaultState): ControlResult {
  const permitted = new Set<string>([...s.allowedDestinations, s.custodianAddress]);
  const exceptions: string[] = [];

  for (const t of outflows) {
    if (!t.destination) {
      exceptions.push(`${t.hash}: payment with no destination field`);
      continue;
    }
    if (!permitted.has(t.destination)) {
      exceptions.push(`${t.hash}: paid ${t.destination}, which is not allowlisted`);
    }
  }

  if (outflows.length === 0) {
    return {
      id: "C1",
      title: "Outflow destination allowlist",
      assertion: "Every payment sent by the Core Vault lands on an allowlisted address or the custodian.",
      opinion: "DISCLAIMER",
      tested: 0,
      exceptions: [],
      disclaimer: "no outflows in the evidence window — nothing to test, which is not the same as compliance",
    };
  }

  return {
    id: "C1",
    title: "Outflow destination allowlist",
    assertion: "Every payment sent by the Core Vault lands on an allowlisted address or the custodian.",
    opinion: exceptions.length === 0 ? "CLEAN" : "EXCEPTION",
    tested: outflows.length,
    exceptions,
  };
}

/**
 * C2 — the allowlist is non-empty and the custodian is set.
 *
 * An empty allowlist would make C1 vacuously strict; an unset custodian would
 * make it vacuously loose. Testing the control's own preconditions stops C1
 * reporting CLEAN for the wrong reason.
 */
export function controlAllowlistIntegrity(s: CoreVaultState): ControlResult {
  const exceptions: string[] = [];
  if (s.allowedDestinations.length === 0) exceptions.push("destination allowlist is empty");
  if (!s.custodianAddress) exceptions.push("custodian address is not set");
  if (!s.coreVaultAddress) exceptions.push("core vault address is not set");

  const dupes = s.allowedDestinations.filter((a, i) => s.allowedDestinations.indexOf(a) !== i);
  if (dupes.length > 0) exceptions.push(`duplicate allowlist entries: ${[...new Set(dupes)].join(", ")}`);

  return {
    id: "C2",
    title: "Control preconditions",
    assertion: "The allowlist is populated, deduplicated, and the custodian and vault addresses are set.",
    opinion: exceptions.length === 0 ? "CLEAN" : "EXCEPTION",
    tested: s.allowedDestinations.length,
    exceptions,
  };
}

/**
 * C3 — escrow reconciles between the two contracts that report it.
 *
 * ⚠ This control was WRONG on its first run and produced a false exception
 * against Flare. It originally asserted
 *   `availableFunds + escrowedFunds <= totalAvailableUBA`
 * across two contracts, and flagged a 400 UBA breach.
 *
 * The relationship that actually holds — exactly, delta zero — is
 *   `escrowedFunds == totalAvailableUBA - immediatelyAvailableUBA`
 * The 400 UBA sits entirely between `CoreVaultManager.availableFunds` (the raw
 * balance) and `AssetManager.immediatelyAvailableUBA` (net of a fee). Those two
 * were never defined to be equal, so asserting it manufactured a breach.
 *
 * Testing an undocumented relationship and reporting EXCEPTION is the exact
 * failure that destroys an assurance product: a false accusation is far more
 * damaging than a missed finding. The control now tests only the identity that
 * is actually defined, and reports the fee delta as an observation.
 */
export function controlEscrowReconciliation(s: CoreVaultState): ControlResult {
  if (s.reportedTotalUBA === undefined || s.immediatelyAvailableUBA === undefined) {
    return {
      id: "C3",
      title: "Escrow reconciliation",
      assertion:
        "Escrowed funds equal the difference between the asset manager's total and immediately available amounts.",
      opinion: "DISCLAIMER",
      tested: 0,
      exceptions: [],
      disclaimer:
        "the asset manager's reported amounts were not obtained, so no reconciliation is possible",
    };
  }

  const escrowed = BigInt(s.escrowedFundsUBA);
  const available = BigInt(s.availableFundsUBA);
  const total = BigInt(s.reportedTotalUBA);
  const immediate = BigInt(s.immediatelyAvailableUBA);
  const exceptions: string[] = [];

  if (escrowed !== total - immediate) {
    exceptions.push(
      `escrowed (${escrowed}) does not equal total − immediate (${total - immediate})`,
    );
  }

  // The manager's raw balance should never be LESS than what the asset manager
  // advertises as immediately available — that direction would mean the system
  // is offering funds the vault does not hold, and is a genuine breach.
  if (available < immediate) {
    exceptions.push(
      `manager availableFunds (${available}) is below asset manager immediatelyAvailable (${immediate})`,
    );
  }

  return {
    id: "C3",
    title: "Escrow reconciliation",
    assertion:
      "Escrowed funds equal total minus immediately available, and the raw balance is never below what is advertised.",
    opinion: exceptions.length === 0 ? "CLEAN" : "EXCEPTION",
    tested: 2,
    exceptions,
  };
}

/**
 * C4 — the fee wedge between the two available-fund figures is disclosed.
 *
 * Not a pass/fail control. `availableFunds` (raw) minus `immediatelyAvailable`
 * (net) is a real, expected quantity, and publishing it every period is how a
 * silent change in it would ever be noticed. Reported as an observation with a
 * CLEAN opinion unless the wedge is negative, which C3 already catches.
 */
export function observeFeeWedge(s: CoreVaultState): ControlResult {
  if (s.immediatelyAvailableUBA === undefined) {
    return {
      id: "C4",
      title: "Available-funds wedge",
      assertion: "The difference between the raw and advertised available balances is disclosed.",
      opinion: "DISCLAIMER",
      tested: 0,
      exceptions: [],
      disclaimer: "the asset manager's immediately-available amount was not obtained",
    };
  }
  const wedge = BigInt(s.availableFundsUBA) - BigInt(s.immediatelyAvailableUBA);
  return {
    id: "C4",
    title: "Available-funds wedge",
    assertion: "The difference between the raw and advertised available balances is disclosed.",
    opinion: "CLEAN",
    tested: 1,
    exceptions: [],
    disclaimer: undefined,
    observation: `raw availableFunds exceeds advertised immediatelyAvailable by ${wedge} UBA (expected: the asset manager nets a fee)`,
  };
}

/**
 * Roll individual controls into one opinion.
 *
 * EXCEPTION dominates: any breach makes the period an exception regardless of
 * what else passed. DISCLAIMER outranks CLEAN, because a period where evidence
 * was missing must not read as a clean one — that inversion is the single
 * easiest way for an assurance product to become dishonest.
 */
export function rollUp(controls: readonly ControlResult[]): Opinion {
  if (controls.some((c) => c.opinion === "EXCEPTION")) return "EXCEPTION";
  if (controls.some((c) => c.opinion === "DISCLAIMER")) return "DISCLAIMER";
  return "CLEAN";
}

/** FNV-1a over the evidence, so two runs over the same facts are comparable. */
export function evidenceDigest(txs: readonly XrplTx[], s: CoreVaultState): string {
  const material = [
    s.coreVaultAddress,
    s.custodianAddress,
    [...s.allowedDestinations].sort().join(","),
    s.availableFundsUBA,
    s.escrowedFundsUBA,
    ...txs.map((t) => `${t.hash}:${t.destination ?? ""}:${t.amountDrops ?? ""}:${t.successful}`),
  ].join("|");

  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `0x${h.toString(16).padStart(8, "0")}`;
}

export function runCv1(txs: readonly XrplTx[], s: CoreVaultState, period: string): Cv1Report {
  const outflows = outflowsOf(txs, s.coreVaultAddress);
  const controls = [
    controlAllowlistIntegrity(s),
    controlAllowlist(outflows, s),
    controlEscrowReconciliation(s),
    observeFeeWedge(s),
  ];
  const ledgers = txs.map((t) => t.ledgerIndex).filter((n) => n > 0);

  return {
    procedureId: "CV-1",
    period,
    state: s,
    controls,
    opinion: rollUp(controls),
    evidence: {
      xrplTransactions: txs.length,
      outflows: outflows.length,
      ledgerRange: ledgers.length > 0 ? [Math.min(...ledgers), Math.max(...ledgers)] : null,
      evidenceDigest: evidenceDigest(txs, s),
    },
  };
}
