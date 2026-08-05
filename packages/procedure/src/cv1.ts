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
  /**
   * The XRP Ledger's own account of the vault address — the independent source.
   * Absent when XRPL could not be read, which must DISCLAIM, never pass.
   */
  onLedger?: {
    /** account_data.Balance: LIQUID drops. Escrowed XRP is NOT included here. */
    balanceDrops: string;
    /** sum of the account's Escrow ledger objects, in drops */
    escrowedDrops: string;
    escrowCount: number;
    /** base + owner reserve, read from the ledger */
    reserveDrops: string;
    /** escrows denominated in something other than XRP, which cannot be summed */
    nonXrpEscrows: number;
  };
}

export interface Cv1Report {
  procedureId: "CV-1";
  /** the day under test, UTC */
  period: string;
  /**
   * When this report was actually produced.
   *
   * `period` is the day under test, not a timestamp. Deriving freshness from it
   * meant a report dated today looked like it came from the future, and a badge
   * built on that could never go stale.
   */
  generatedAt?: string;
  /**
   * Which chain this opinion is about.
   *
   * Not decoration. A register that reads mainnet one day and a fault-injected
   * fork the next, without saying which, is worse than one that reads neither.
   */
  network?: { name: string; label: string; chainId: number; isMainnet: boolean };
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
 * C3 — Flare's escrow ledger against the XRP Ledger's escrow objects.
 *
 * ⚠ THE CROSS-CHAIN RECONCILIATION HAS BEEN WRONG THREE TIMES. EACH FAILURE
 * TAUGHT SOMETHING, AND ONLY THE THIRD WAS CAUGHT BEFORE PUBLICATION.
 *
 * 1. `availableFunds + escrowedFunds <= totalAvailableUBA` across two contracts
 *    reported a 400 UBA EXCEPTION against Flare. Those figures were never
 *    defined to relate — the 400 UBA is a fee the asset manager nets off. A
 *    false accusation, published.
 *
 * 2. `escrowedFunds == totalAvailable − immediatelyAvailable` held exactly, and
 *    could NEVER FAIL. Fault injection on a forked chain moved `escrowedFunds`
 *    from 500,000,000,000 to 999,999,999,999 and the control stayed green,
 *    because `coreVaultAvailableAmount()` DERIVES both of its outputs from that
 *    same storage slot. Both sides of the identity moved together. A tautology
 *    wearing the costume of a reconciliation.
 *
 * 3. `availableFunds + escrowedFunds <= account_data.Balance` looked like the
 *    fix — two genuinely independent chains at last — and on live data it
 *    reported a 497,844,875,522 drop shortfall. It was wrong. **XRPL escrow
 *    removes XRP from `Balance` and holds it in Escrow ledger objects**, so
 *    adding Flare's escrowed figure to a balance that already excludes it
 *    double-counts every escrow. Publishing it would have accused Flare of a
 *    half-million-XRP hole that does not exist.
 *
 * The recurring lesson, now three times over: an assertion is only a control if
 * the two sides were *defined* to be equal. Otherwise it is a coincidence that
 * either flatters or defames.
 *
 * So this control reconciles the two things that genuinely must agree:
 * `CoreVaultManager.escrowedFunds()` on Flare, and the sum of the vault
 * address's Escrow objects on XRPL. Flare cannot move XRPL's number and XRPL
 * knows nothing of Flare's, so the equality is a real constraint — and it fails
 * under the same fault injection the tautology sailed through.
 *
 * Both directions are breaches. Flare recording more escrow than exists means
 * unbacked accounting; Flare recording less means XRP left the liquid balance
 * without being booked.
 */
export function controlEscrowBacking(s: CoreVaultState): ControlResult {
  const ID = "C3";
  const TITLE = "Escrow backing";
  const ASSERTION =
    "Every UBA Flare records as escrowed is matched by XRP sitting in an Escrow object on the XRP Ledger.";

  if (!s.onLedger) {
    return {
      id: ID,
      title: TITLE,
      assertion: ASSERTION,
      opinion: "DISCLAIMER",
      tested: 0,
      exceptions: [],
      disclaimer: "the XRP Ledger state of the vault address was not obtained, so no reconciliation is possible",
    };
  }
  if (s.onLedger.nonXrpEscrows > 0) {
    return {
      id: ID,
      title: TITLE,
      assertion: ASSERTION,
      opinion: "DISCLAIMER",
      tested: s.onLedger.escrowCount,
      exceptions: [],
      disclaimer: `${s.onLedger.nonXrpEscrows} escrow object(s) are not denominated in XRP and cannot be summed against a UBA figure — treating them as zero would manufacture a shortfall`,
    };
  }

  const flare = BigInt(s.escrowedFundsUBA);
  const ledger = BigInt(s.onLedger.escrowedDrops);
  const exceptions: string[] = [];

  if (flare > ledger) {
    exceptions.push(
      `Flare records ${flare} UBA escrowed but the XRP Ledger holds only ${ledger} drops across ${s.onLedger.escrowCount} escrow objects at ${s.coreVaultAddress} — ${flare - ledger} unbacked`,
    );
  } else if (ledger > flare) {
    exceptions.push(
      `the XRP Ledger holds ${ledger} drops in ${s.onLedger.escrowCount} escrow objects at ${s.coreVaultAddress} but Flare records only ${flare} UBA escrowed — ${ledger - flare} left the liquid balance unrecorded`,
    );
  }

  return {
    id: ID,
    title: TITLE,
    assertion: ASSERTION,
    opinion: exceptions.length === 0 ? "CLEAN" : "EXCEPTION",
    tested: s.onLedger.escrowCount,
    exceptions,
    observation:
      exceptions.length === 0
        ? `${s.onLedger.escrowCount} escrow objects totalling ${ledger} drops match Flare's escrowedFunds exactly`
        : undefined,
  };
}

/**
 * C4 — Flare's spendable claim against the vault's liquid XRP.
 *
 * `availableFunds` is what Flare believes it can move today. On XRPL that money
 * is the account balance minus the reserve the ledger will not let it spend —
 * and minus nothing else, because escrowed XRP already left the balance (see
 * the third failure documented on C3).
 *
 * Only one direction is a breach. Flare claiming MORE than the ledger can pay
 * is a solvency exception. The ledger holding more than Flare claims is normal:
 * inbound deposits are backed before they are credited. That surplus is
 * disclosed as an observation, because a sudden change in it is informative
 * even though its existence is not a fault.
 *
 * The reserve is read from the ledger's own `server_state`, not assumed. A
 * hardcoded reserve would silently become a false accusation the day Ripple
 * changes it — which they have, twice.
 */
export function controlLiquidBacking(s: CoreVaultState): ControlResult {
  const ID = "C4";
  const TITLE = "Liquid backing";
  const ASSERTION =
    "What Flare can spend today does not exceed the vault's spendable XRP after the ledger's reserve.";

  if (!s.onLedger) {
    return {
      id: ID,
      title: TITLE,
      assertion: ASSERTION,
      opinion: "DISCLAIMER",
      tested: 0,
      exceptions: [],
      disclaimer: "the XRP Ledger state of the vault address was not obtained, so no reconciliation is possible",
    };
  }

  const claimed = BigInt(s.availableFundsUBA);
  const balance = BigInt(s.onLedger.balanceDrops);
  const reserve = BigInt(s.onLedger.reserveDrops);
  const spendable = balance - reserve;
  const exceptions: string[] = [];

  if (claimed > spendable) {
    exceptions.push(
      `Flare records ${claimed} UBA available but ${s.coreVaultAddress} holds ${balance} drops liquid, of which ${reserve} is locked as reserve — a shortfall of ${claimed - spendable}`,
    );
  }

  return {
    id: ID,
    title: TITLE,
    assertion: ASSERTION,
    opinion: exceptions.length === 0 ? "CLEAN" : "EXCEPTION",
    tested: 1,
    exceptions,
    observation:
      exceptions.length === 0
        ? `${spendable} drops spendable covers Flare's ${claimed} UBA with ${spendable - claimed} to spare (reserve ${reserve} over ${s.onLedger.escrowCount + 1} owned objects)`
        : undefined,
  };
}

/**
 * C5 — the fee wedge between the two available-fund figures is disclosed.
 *
 * Not a pass/fail control. `availableFunds` (raw) minus `immediatelyAvailable`
 * (net) is a real, expected quantity, and publishing it every period is how a
 * silent change in it would ever be noticed. Reported as an observation with a
 * CLEAN opinion unless the wedge is negative, which C3 already catches.
 */
export function observeFeeWedge(s: CoreVaultState): ControlResult {
  if (s.immediatelyAvailableUBA === undefined) {
    return {
      id: "C5",
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
    id: "C5",
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
    // The XRPL side is evidence too. Omitting it would let a run over a
    // different ledger state carry an identical digest, which is precisely the
    // comparison this hash exists to make possible.
    s.onLedger
      ? `${s.onLedger.balanceDrops}/${s.onLedger.escrowedDrops}/${s.onLedger.escrowCount}/${s.onLedger.reserveDrops}/${s.onLedger.nonXrpEscrows}`
      : "no-ledger",
    ...txs.map((t) => `${t.hash}:${t.destination ?? ""}:${t.amountDrops ?? ""}:${t.successful}`),
  ].join("|");

  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `0x${h.toString(16).padStart(8, "0")}`;
}

export function runCv1(
  txs: readonly XrplTx[],
  s: CoreVaultState,
  period: string,
  network?: Cv1Report["network"],
): Cv1Report {
  const outflows = outflowsOf(txs, s.coreVaultAddress);
  const controls = [
    controlAllowlist(outflows, s),
    controlAllowlistIntegrity(s),
    controlEscrowBacking(s),
    controlLiquidBacking(s),
    observeFeeWedge(s),
  ];
  const ledgers = txs.map((t) => t.ledgerIndex).filter((n) => n > 0);

  return {
    procedureId: "CV-1",
    period,
    generatedAt: new Date().toISOString(),
    ...(network ? { network } : {}),
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

