/**
 * Which chain, and where everything lives on it.
 *
 * The addresses used to be two hardcoded Coston2 constants. That was fine
 * while the register only ever read a testnet, and it quietly encoded a claim
 * we did not want to make: that this procedure was a testnet exercise. It is
 * not. Every input CV-1 reads is public on Flare mainnet too, and the
 * procedure only ever reads, so running against mainnet costs nothing, risks
 * nothing, and requires no capital.
 *
 * Nothing is hardcoded now except the Flare Contract Registry, which is the
 * one address Flare documents as permanent and identical on every network.
 * Everything else is resolved through it at run time:
 *
 *   ContractRegistry -> AssetManagerController -> getAssetManagers()
 *                    -> AssetManager.getCoreVaultManager()
 *
 * That is not just tidier. It means a new FAsset appearing on either chain is
 * discovered rather than missed, and it means the register cannot silently
 * read a stale address after a Flare upgrade — a redeployed AssetManager moves
 * the whole procedure with it.
 */
import { createPublicClient, http, defineChain, type Address, type PublicClient } from "viem";

/** Documented by Flare as the same address on every network. */
export const CONTRACT_REGISTRY: Address = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

export type NetworkName = "flare" | "coston2";

export interface NetworkSpec {
  name: NetworkName;
  chainId: number;
  rpc: string;
  /** the XRPL cluster whose ledgers back this Flare network's FAssets */
  xrplEndpoints: readonly string[];
  /** human label used in report headers */
  label: string;
  /** whether this is the network real value settles on */
  isMainnet: boolean;
}

export const NETWORKS: Record<NetworkName, NetworkSpec> = {
  flare: {
    name: "flare",
    chainId: 14,
    rpc: "https://flare-api.flare.network/ext/C/rpc",
    xrplEndpoints: ["https://xrplcluster.com", "https://s2.ripple.com:51234"],
    label: "Flare mainnet",
    isMainnet: true,
  },
  coston2: {
    name: "coston2",
    chainId: 114,
    rpc: "https://coston2-api.flare.network/ext/C/rpc",
    xrplEndpoints: ["https://s.altnet.rippletest.net:51234", "https://testnet.xrpl-labs.com"],
    label: "Flare Coston2",
    isMainnet: false,
  },
};

/**
 * Resolve the network from the environment.
 *
 * Defaults to mainnet. The register's subject is the system real value settles
 * on; Coston2 is where we are allowed to break things, and it has to be asked
 * for explicitly so a fault-injection run can never be mistaken for a reading
 * of production.
 */
export function selectNetwork(): NetworkSpec {
  const raw = (process.env.NETWORK ?? "flare").toLowerCase();
  const spec = NETWORKS[raw as NetworkName];
  if (!spec) {
    throw new Error(`unknown NETWORK "${raw}" — expected one of ${Object.keys(NETWORKS).join(", ")}`);
  }
  return spec;
}

export function clientFor(spec: NetworkSpec, rpcOverride?: string): PublicClient {
  const rpc = rpcOverride ?? process.env.RPC_URL ?? spec.rpc;
  const chain = defineChain({
    id: spec.chainId,
    name: spec.label,
    nativeCurrency: { name: spec.isMainnet ? "FLR" : "C2FLR", symbol: spec.isMainnet ? "FLR" : "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  return createPublicClient({ chain, transport: http(rpc, { batch: true }) }) as PublicClient;
}

const registryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;

const controllerAbi = [
  { type: "function", name: "getAssetManagers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;

const managerAbi = [
  { type: "function", name: "getCoreVaultManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const fassetAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export interface ResolvedAddresses {
  network: NetworkSpec;
  assetManagerController: Address;
  assetManager: Address;
  coreVaultManager: Address;
  /** e.g. "FXRP" — read from the token rather than assumed */
  symbol: string;
  /** every asset manager the controller knows about, for disclosure */
  allAssetManagers: readonly Address[];
}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Walk the registry to whatever is actually deployed.
 *
 * Throws rather than falling back to a guess. A register that silently reads a
 * stale or wrong address would produce confident opinions about the wrong
 * contract, which is worse than producing none.
 */
export async function resolveAddresses(
  client: PublicClient,
  spec: NetworkSpec,
  opts: { symbol?: string } = {},
): Promise<ResolvedAddresses> {
  const assetManagerController = (await client.readContract({
    address: CONTRACT_REGISTRY,
    abi: registryAbi,
    functionName: "getContractAddressByName",
    args: ["AssetManagerController"],
  })) as Address;

  if (assetManagerController === ZERO) {
    throw new Error(`${spec.label}: the contract registry has no AssetManagerController`);
  }

  const allAssetManagers = (await client.readContract({
    address: assetManagerController,
    abi: controllerAbi,
    functionName: "getAssetManagers",
  })) as readonly Address[];

  if (allAssetManagers.length === 0) {
    throw new Error(`${spec.label}: AssetManagerController lists no asset managers`);
  }

  // Pick by the token's own symbol rather than by array position, so a second
  // FAsset launching cannot silently repoint the register at a different asset.
  const wanted = (opts.symbol ?? process.env.FASSET ?? "FXRP").toUpperCase();
  let chosen: { address: Address; symbol: string } | null = null;
  const seen: string[] = [];

  for (const am of allAssetManagers) {
    const token = (await client.readContract({ address: am, abi: managerAbi, functionName: "fAsset" })) as Address;
    const symbol = (await client.readContract({ address: token, abi: fassetAbi, functionName: "symbol" })) as string;
    seen.push(symbol);
    if (symbol.toUpperCase() === wanted) {
      chosen = { address: am, symbol };
      break;
    }
  }

  if (!chosen) {
    throw new Error(`${spec.label}: no asset manager for ${wanted} — found ${seen.join(", ") || "none"}`);
  }

  const coreVaultManager = (await client.readContract({
    address: chosen.address,
    abi: managerAbi,
    functionName: "getCoreVaultManager",
  })) as Address;

  if (coreVaultManager === ZERO) {
    throw new Error(`${spec.label}: ${chosen.symbol} asset manager has no Core Vault manager`);
  }

  return {
    network: spec,
    assetManagerController,
    assetManager: chosen.address,
    coreVaultManager,
    symbol: chosen.symbol,
    allAssetManagers,
  };
}
