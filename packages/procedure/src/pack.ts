/**
 * Evidence packs — freeze the inputs, not just the conclusion.
 *
 * A finding whose evidence depends on a live endpoint is a claim with an expiry
 * date. Today CV-1 reads two chains and publishes an opinion; if either RPC
 * changes, prunes, or dies, nobody can ever check that opinion again. The
 * verdict outlives its evidence, which is the wrong way round.
 *
 * So a finding is split in two:
 *
 *   EVIDENCE PACK   the exact bytes the procedure consumed, at pinned heights,
 *                   canonically serialised and content-addressed
 *   VERDICT         derived from that pack by a PURE function, no network
 *
 * That split is the architectural keystone. Everything worth building next is
 * downstream of it: offline replay in ten years, independent mirrors that can
 * disagree, a register that survives its author, and — immediately, at one
 * runner — replaying today's code over last month's frozen pack to catch
 * semantic drift we would otherwise never see.
 *
 * ── WHY SHA-256 AND NOT THE EXISTING DIGEST ────────────────────────────────
 *
 * `evidenceDigest` is FNV-1a over a summary string. Thirty-two bits is a fine
 * human comparator — it makes two runs visibly the same or visibly different —
 * and it is useless as a content address: collisions are findable by hand, and
 * it hashes a rendering of the evidence rather than the evidence. A pack is
 * addressed by SHA-256 over canonical bytes. The old digest stays for
 * continuity and is never treated as an address.
 *
 * ── CANONICAL FORM ─────────────────────────────────────────────────────────
 *
 * Two honest runners must produce byte-identical packs from identical chain
 * state, or every comparison downstream is noise. So: keys sorted recursively,
 * no insignificant whitespace, every integer a decimal string (a JSON number
 * would silently lose precision on `uint256`), and no timestamps or hostnames
 * anywhere inside the hashed region — those are metadata, kept beside the pack
 * rather than in it.
 */
import { createHash } from "node:crypto";

/** One JSON-RPC read, recorded exactly as it was answered. */
export interface RecordedRead {
  /** e.g. "flare.eth_call" or "xrpl.account_objects" */
  method: string;
  /** canonical params, already stringified */
  params: string;
  /** the raw result, verbatim */
  result: unknown;
}

export interface EvidencePack {
  schema: "therecord.pack/v1";
  procedureId: string;
  network: { name: string; chainId: number };
  /** the heights everything was read at — the pack means nothing without them */
  anchors: {
    flareBlock: number;
    xrplLedger: number;
    /** how far apart the two chains actually were, in seconds */
    skewSeconds: number;
  };
  reads: RecordedRead[];
}

/**
 * Canonical JSON: sorted keys, no whitespace, bigints as decimal strings.
 *
 * `JSON.stringify` alone is not enough. Key order follows insertion order, so
 * two runners that built the same object differently would hash differently
 * while agreeing about every fact — a disagreement about nothing, which is the
 * most expensive kind.
 */
export function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    // A JSON number cannot hold a uint256. Anything numeric that matters is
    // already a string by the time it reaches here; this catches the rest.
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Content address of a pack. Stable across machines, runs and years. */
export function packHash(pack: EvidencePack): string {
  return `0x${createHash("sha256").update(canonical(pack), "utf8").digest("hex")}`;
}

/**
 * A recorder that captures reads as they happen.
 *
 * Deliberately dumb: it does not know what CV-1 means by any of these calls, so
 * it cannot accidentally normalise away a difference that mattered.
 */
export class PackRecorder {
  private readonly reads: RecordedRead[] = [];

  record(method: string, params: unknown, result: unknown): void {
    this.reads.push({ method, params: canonical(params), result });
  }

  /**
   * Reads are sorted by (method, params) rather than kept in call order.
   *
   * Call order is an artifact of how the code happened to be written — a
   * `Promise.all` can resolve in any sequence, and two honest runners would
   * then produce different packs from identical chain state. Sorting makes the
   * pack a set of facts rather than a transcript of one program's execution.
   */
  build(meta: Omit<EvidencePack, "schema" | "reads">): EvidencePack {
    const reads = [...this.reads].sort((a, b) =>
      a.method === b.method ? a.params.localeCompare(b.params) : a.method.localeCompare(b.method),
    );
    return { schema: "therecord.pack/v1", ...meta, reads };
  }
}

/**
 * Replay a pack: look up what a call was answered with, offline.
 *
 * Throws on a miss rather than returning undefined. A verification that
 * silently proceeds with missing evidence would produce a confident opinion
 * about facts it never saw — the exact failure this whole module exists to
 * make impossible.
 */
export class PackReader {
  private readonly index = new Map<string, unknown>();

  constructor(private readonly pack: EvidencePack) {
    for (const r of pack.reads) this.index.set(`${r.method}|${r.params}`, r.result);
  }

  get<T>(method: string, params: unknown): T {
    const key = `${method}|${canonical(params)}`;
    if (!this.index.has(key)) {
      throw new Error(
        `evidence pack ${packHash(this.pack).slice(0, 12)}… has no recorded answer for ${method} ${canonical(params)} — ` +
          "the pack was produced by a different procedure, or the procedure changed what it reads",
      );
    }
    return this.index.get(key) as T;
  }

  get anchors(): EvidencePack["anchors"] {
    return this.pack.anchors;
  }

  /** Every read in the pack, for a caller that wants to enumerate rather than look up. */
  get reads(): readonly RecordedRead[] {
    return this.pack.reads;
  }
}

export interface PackEnvelope {
  packHash: string;
  /** when the pack was captured — metadata, deliberately OUTSIDE the hash */
  capturedAt: string;
  pack: EvidencePack;
}

export function envelope(pack: EvidencePack, capturedAt = new Date().toISOString()): PackEnvelope {
  return { packHash: packHash(pack), capturedAt, pack };
}
