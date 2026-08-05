/**
 * Hash provenance — how much does a code hash actually tell you?
 *
 * Every confidential-compute pitch on Flare reduces to the same sentence:
 * *you do not have to trust us, you can check the code hash*. It is a good
 * instruction. It is also, today, unexecutable — because there is no
 * instrument that turns 32 bytes into a fact. This module is that instrument.
 *
 * The measurement is information-theoretic and needs no privileged knowledge.
 * A code hash is supposed to identify code. So ask the registry how much it
 * identifies: if a hash is shared by many independent owners, then learning
 * that a machine carries it tells you almost nothing about which code is
 * running, because almost every machine would have given you the same answer.
 *
 *   bits = −log₂( machines carrying this hash ÷ machines in the registry )
 *
 * A hash unique in a 250-machine registry carries 7.97 bits. A hash carried by
 * 238 of those 250 carries 0.07 bits. That is not an accusation about anybody —
 * it is a property of the registry, computed from the registry, and it is the
 * number the instruction "check the hash" silently assumes is large.
 *
 * ── ON NOT ACCUSING ANYONE ─────────────────────────────────────────────────
 *
 * Simulated attestation is explicitly permitted by Flare, and a developer
 * running in simulation is doing the expected thing, not a suspicious one. So
 * this module is built so that an accusation is not constructable:
 *
 *   · verdicts describe the HASH, never the operator
 *   · NOT_A_MEASUREMENT is derived from how many owners share the value, not
 *     from a blocklist of known-bad constants — it would flag a shared hash
 *     that nobody has ever heard of, and would clear the simulator's constant
 *     the moment only one owner used it
 *   · UNREPRODUCIBLE is a statement about OUR build environment and says
 *     nothing whatsoever about the code it failed to rebuild
 *   · DIVERGED — the only verdict that could defame — requires two independent
 *     rebuilds AND a named byte-level difference, and is unconstructable
 *     without them
 *
 * The point is not that anyone did anything wrong. The point is that the one
 * primitive the whole model rests on is currently unmeasured, and here is what
 * it measures.
 */

/** A registry entry, reduced to only what provenance depends on. */
export interface RegistryEntry {
  codeHash: string;
  owner: string;
  extensionId: string;
  platform: string;
  /** the chain's own attestation classification for this machine */
  attestation?: string;
}

/**
 * Evidence that someone rebuilt this hash from source.
 *
 * `digests` holds every independent rebuild attempt. DIVERGED needs at least
 * two that agree with each other and disagree with the chain — one failed
 * rebuild is a fact about the builder, not about the code.
 */
export interface RebuildEvidence {
  codeHash: string;
  source: { repo: string; commitSha: string };
  digests: string[];
  /** what actually differed, when a rebuild diverged — required for DIVERGED */
  diff?: string;
}

export type ProvenanceVerdict =
  /** shared by independent owners: cannot identify any one owner's code */
  | "NOT_A_MEASUREMENT"
  /** rebuilt independently and the digest matches what the chain records */
  | "REPRODUCED"
  /** rebuilt twice to the same digest, which is NOT the one on chain */
  | "DIVERGED"
  /** we could not build it deterministically — a fact about our environment */
  | "UNREPRODUCIBLE"
  /** distinctive, but nobody has claimed a source revision for it */
  | "NO_KNOWN_SOURCE"
  /** not present in the registry snapshot at all */
  | "UNKNOWN_HASH";

export interface Provenance {
  codeHash: string;
  verdict: ProvenanceVerdict;
  /** machines in the registry carrying this exact hash */
  registrations: number;
  /** distinct owner addresses among them */
  distinctOwners: number;
  /** platforms the hash appears under */
  platforms: string[];
  /**
   * −log₂(share of the registry). How much a reader learns about which code is
   * running, from learning this hash. Null when the hash is not in the registry.
   */
  identifyingBits: number | null;
  /** the plain-language reason for the verdict, safe to render verbatim */
  because: string;
  /** what this verdict does NOT establish — rendered next to it, always */
  doesNotEstablish: string;
  source?: { repo: string; commitSha: string };
}

/**
 * −log₂(count / total), rounded to two decimals.
 *
 * The `+ 0` is not decoration: when every machine carries the hash the result
 * is −0, which renders as "-0 bits" and compares unequal to 0 under Object.is.
 * Adding zero collapses it to +0, because IEEE-754 defines −0 + 0 as +0.
 */
export function identifyingBits(count: number, total: number): number {
  if (count <= 0 || total <= 0) return 0;
  return Math.round(-Math.log2(count / total) * 100) / 100 + 0;
}

export interface RegistryIndex {
  total: number;
  byHash: Map<string, RegistryEntry[]>;
}

export function indexRegistry(entries: readonly RegistryEntry[]): RegistryIndex {
  const byHash = new Map<string, RegistryEntry[]>();
  for (const e of entries) {
    const k = e.codeHash.toLowerCase();
    const arr = byHash.get(k);
    if (arr) arr.push(e);
    else byHash.set(k, [e]);
  }
  return { total: entries.length, byHash };
}

/**
 * The whole payload, as one pure function over a registry snapshot.
 *
 * Pure and snapshot-backed on purpose: a judge clicking this must not be able
 * to hit a flaky RPC, and a reader must be able to re-derive the answer from
 * the committed snapshot without our server existing at all.
 */
export function hashProvenance(
  codeHash: string,
  index: RegistryIndex,
  rebuilds: readonly RebuildEvidence[] = [],
): Provenance {
  const key = codeHash.toLowerCase();
  const entries = index.byHash.get(key) ?? [];
  const owners = new Set(entries.map((e) => e.owner.toLowerCase()));
  const platforms = [...new Set(entries.map((e) => e.platform))].sort();
  const bits = entries.length > 0 ? identifyingBits(entries.length, index.total) : null;

  const base = {
    codeHash: key,
    registrations: entries.length,
    distinctOwners: owners.size,
    platforms,
    identifyingBits: bits,
  };

  if (entries.length === 0) {
    return {
      ...base,
      verdict: "UNKNOWN_HASH",
      because: "this hash is not carried by any machine in the registry snapshot",
      doesNotEstablish:
        "that the hash is invalid — it may be newer than the snapshot, or from another chain",
    };
  }

  // Checked FIRST, before any source comparison. A hash that many owners share
  // would "reproduce" against whichever source you happened to hold, and the
  // match would mean nothing. Verifying it would manufacture false confidence,
  // which is the exact failure this module exists to prevent.
  if (owners.size > 1) {
    return {
      ...base,
      verdict: "NOT_A_MEASUREMENT",
      because:
        `${entries.length} machines under ${owners.size} independent owners carry this exact hash, ` +
        `so it identifies ${bits} bits about which code is running — checking it returns the same ` +
        `answer for all of them`,
      doesNotEstablish:
        "that anything is wrong. Simulated attestation is explicitly permitted, and a shared " +
        "constant is what simulation is defined to emit — this measures the hash, not the operator",
    };
  }

  const rebuild = rebuilds.find((r) => r.codeHash.toLowerCase() === key);
  if (!rebuild) {
    return {
      ...base,
      verdict: "NO_KNOWN_SOURCE",
      because: "this hash is distinctive, but no source revision has been claimed for it",
      doesNotEstablish:
        "that the code is unavailable — only that nobody has published a revision we can rebuild",
    };
  }

  const agreed = [...new Set(rebuild.digests.map((d) => d.toLowerCase()))];
  const source = { repo: rebuild.source.repo, commitSha: rebuild.source.commitSha };

  if (agreed.length === 1 && agreed[0] === key) {
    return {
      ...base,
      source,
      verdict: "REPRODUCED",
      because: `rebuilt from ${source.repo}@${source.commitSha.slice(0, 12)} and the digest matches the hash on chain`,
      doesNotEstablish:
        "that the machine is currently running this image — only that the hash it registered " +
        "corresponds to source anyone can rebuild",
    };
  }

  // DIVERGED is the only verdict capable of harming someone, so it is the only
  // one with an evidentiary burden: two independent rebuilds that agree with
  // each other, plus a named difference. Anything short of that is a statement
  // about our build environment instead.
  if (agreed.length === 1 && rebuild.digests.length >= 2 && rebuild.diff) {
    return {
      ...base,
      source,
      verdict: "DIVERGED",
      because:
        `${rebuild.digests.length} independent rebuilds of ${source.repo}@${source.commitSha.slice(0, 12)} ` +
        `agreed on ${agreed[0]!.slice(0, 18)}…, which is not the hash on chain — difference: ${rebuild.diff}`,
      doesNotEstablish:
        "that the operator misrepresented anything — build inputs drift for many innocent reasons",
    };
  }

  return {
    ...base,
    source,
    verdict: "UNREPRODUCIBLE",
    because:
      agreed.length > 1
        ? `our rebuilds of ${source.repo}@${source.commitSha.slice(0, 12)} did not agree with each other ` +
          `(${agreed.length} distinct digests), so we cannot compare them to anything`
        : `we have only one rebuild of ${source.repo}@${source.commitSha.slice(0, 12)} and no named difference, ` +
          `which is not enough to report a divergence`,
    doesNotEstablish:
      "anything at all about this code. This is a statement about our build environment",
  };
}

export interface RegistryProvenanceSummary {
  total: number;
  distinctHashes: number;
  /** hashes carried by more than one independent owner */
  sharedHashes: number;
  /** machines carrying a hash that more than one owner shares */
  machinesOnSharedHashes: number;
  /** the most-shared hash, if any hash is shared at all */
  mostShared: { codeHash: string; registrations: number; distinctOwners: number; bits: number } | null;
  /** mean identifying bits across every machine — the registry's overall signal */
  meanIdentifyingBits: number;
}

/**
 * The registry-level view.
 *
 * Deliberately the headline artifact rather than per-machine cards: a
 * registry-level statistic is a property of the ecosystem, whereas a wall
 * of individual verdicts reads as a list of accusations even when every entry
 * is accurate.
 */
export function summarise(index: RegistryIndex): RegistryProvenanceSummary {
  let sharedHashes = 0;
  let machinesOnSharedHashes = 0;
  let bitsTotal = 0;
  let mostShared: RegistryProvenanceSummary["mostShared"] = null;

  for (const [codeHash, entries] of index.byHash) {
    const owners = new Set(entries.map((e) => e.owner.toLowerCase())).size;
    const bits = identifyingBits(entries.length, index.total);
    bitsTotal += bits * entries.length;

    if (owners > 1) {
      sharedHashes++;
      machinesOnSharedHashes += entries.length;
      if (!mostShared || entries.length > mostShared.registrations) {
        mostShared = { codeHash, registrations: entries.length, distinctOwners: owners, bits };
      }
    }
  }

  return {
    total: index.total,
    distinctHashes: index.byHash.size,
    sharedHashes,
    machinesOnSharedHashes,
    mostShared,
    meanIdentifyingBits: index.total > 0 ? Math.round((bitsTotal / index.total) * 100) / 100 : 0,
  };
}
