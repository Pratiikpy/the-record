/**
 * `verify` — re-derive a published opinion from a frozen pack, offline.
 *
 * This is the claim the whole project rests on, made executable: *every figure
 * is re-derivable by anyone*. Until now that was true only while the endpoints
 * were up and answering the same way. A pack makes it true in ten years, on a
 * plane, from a USB stick, with the author dead and the repo gone.
 *
 * It touches no network. Not "prefers not to" — it never constructs a client,
 * and the test suite runs it with global fetch replaced by a throwing stub, so
 * a future edit that quietly reintroduces a live read fails the build rather
 * than passing for the wrong reason.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackReader, packHash, type EvidencePack, type PackEnvelope } from "./pack.js";
import { runCv1, type CoreVaultState, type Cv1Report } from "./cv1.js";
import type { XrplTx } from "./xrpl.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, "..", "out", "packs");

export interface VerifyResult {
  packHash: string;
  /** did the pack's own bytes still hash to its stated address? */
  addressIntact: boolean;
  report: Cv1Report;
}

/**
 * Rebuild CV-1's inputs from a pack and re-run the identical opinion logic.
 *
 * `runCv1` is already pure — it takes state, not clients — which is why this is
 * a short function rather than a second implementation. A second implementation
 * would be a different procedure that happened to agree, and agreement between
 * two things nobody compared is worth nothing.
 */
export function verifyPack(env: PackEnvelope): VerifyResult {
  const pack: EvidencePack = env.pack;
  const recomputed = packHash(pack);
  const reader = new PackReader(pack);

  // Every read comes from the pack. A missing one throws rather than
  // defaulting, so a partial pack can never yield a confident verdict.
  const coreVaultAddress = reader.get<string>("flare.coreVaultAddress", {
    at: addressOf(reader, "flare.coreVaultAddress"),
  });
  const custodianAddress = reader.get<string>("flare.custodianAddress", {
    at: addressOf(reader, "flare.custodianAddress"),
  });
  const availableFundsUBA = reader.get<string>("flare.availableFunds", {
    at: addressOf(reader, "flare.availableFunds"),
  });
  const escrowedFundsUBA = reader.get<string>("flare.escrowedFunds", {
    at: addressOf(reader, "flare.escrowedFunds"),
  });
  const allowedDestinations = reader.get<string[]>("flare.getAllowedDestinationAddresses", {
    at: addressOf(reader, "flare.getAllowedDestinationAddresses"),
  });
  const amounts = reader.get<[string, string]>("flare.coreVaultAvailableAmount", {
    at: addressOf(reader, "flare.coreVaultAvailableAmount"),
  });
  // The recorded XRPL evidence carries its own anchor (ledgerIndex,
  // closeTimeUnix) so the pack is self-describing. Those are provenance, not
  // inputs to the opinion, so they are stripped before the state is rebuilt --
  // otherwise a future field would silently change what CV-1 sees.
  const recorded = reader.get<Record<string, unknown>>("xrpl.accountLedgerState", {
    account: coreVaultAddress,
  });
  const { ledgerIndex: _l, closeTimeUnix: _c, ...rest } = recorded;
  const onLedger = rest as CoreVaultState["onLedger"];
  const txs = reader.get<XrplTx[]>("xrpl.accountTx", { account: coreVaultAddress, limit: 200 });

  const state: CoreVaultState = {
    coreVaultAddress,
    custodianAddress,
    allowedDestinations,
    availableFundsUBA,
    escrowedFundsUBA,
    immediatelyAvailableUBA: amounts[0],
    reportedTotalUBA: amounts[1],
    onLedger,
  };

  const report = runCv1(txs, state, env.capturedAt.slice(0, 10), {
    name: pack.network.name,
    label: pack.network.name === "flare" ? "Flare mainnet" : "Flare Coston2",
    chainId: pack.network.chainId,
    isMainnet: pack.network.chainId === 14,
  });

  return { packHash: recomputed, addressIntact: recomputed === env.packHash, report };
}

/**
 * Recover the contract address a read was recorded against.
 *
 * The address is part of the recorded params, so it has to come back out of the
 * pack rather than be supplied by the verifier — otherwise the verifier would
 * be asserting which contract the evidence describes, and a pack from a
 * different deployment would silently verify against the wrong one.
 */
function addressOf(reader: PackReader, method: string): string {
  for (const r of reader.reads) {
    if (r.method !== method) continue;
    const parsed = JSON.parse(r.params) as { at?: string };
    if (parsed.at) return parsed.at;
  }
  throw new Error(`pack has no read for ${method}`);
}

const log = (m: string): void => void process.stderr.write(`${m}\n`);

function main(): void {
  const arg = process.argv[2];
  if (!existsSync(PACKS)) {
    log(`no packs directory at ${PACKS} — run the procedure first`);
    process.exit(1);
  }

  const files = readdirSync(PACKS).filter((f) => f.endsWith(".json"));
  const chosen = arg ? files.filter((f) => f.includes(arg.replace(/^0x/u, "").slice(0, 16))) : files;

  if (chosen.length === 0) {
    log(arg ? `no pack matching ${arg}` : "no packs found");
    process.exit(1);
  }

  let bad = 0;
  for (const f of chosen) {
    const env = JSON.parse(readFileSync(join(PACKS, f), "utf8")) as PackEnvelope;
    const r = verifyPack(env);

    log("");
    log(`  pack     ${r.packHash}`);
    log(`  address  ${r.addressIntact ? "intact — the bytes still hash to their stated address" : "MISMATCH — the pack was altered after publication"}`);
    log(`  anchors  flare block ${env.pack.anchors.flareBlock} · xrpl ledger ${env.pack.anchors.xrplLedger}`);
    log(`  reads    ${env.pack.reads.length}`);
    log(`  OPINION  ${r.report.opinion}`);
    for (const c of r.report.controls) log(`    ${c.opinion.padEnd(11)} ${c.id}  ${c.title}`);

    if (!r.addressIntact) bad++;
  }

  log("");
  log(bad === 0 ? "✓ verified offline — no network was contacted" : `✗ ${bad} pack(s) failed their own address check`);
  if (bad > 0) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("verify-pack.ts")) main();
