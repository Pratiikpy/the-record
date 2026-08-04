/**
 * Coston2 chain access for the TEE registry.
 *
 * Every address and signature here was read off the live chain or out of
 * flare-foundation/go-flare-common — nothing is assumed. See docs/EVIDENCE.md.
 */
import { createPublicClient, http, defineChain, type Address, type Hex } from "viem";

export const coston2 = defineChain({
  id: 114,
  name: "Flare Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://coston2-api.flare.network/ext/C/rpc",
        "https://flare-testnet-coston2.rpc.thirdweb.com",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Flarescan", url: "https://coston2.testnet.flarescan.com" },
  },
});

/** FlareTeeManager diamond on Coston2 (config/coston2/deployed-addresses.json). */
export const FLARE_TEE_MANAGER: Address = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";

/**
 * Public extension ids start at 0x10000; anything below is a reserved system
 * extension. `nextPublicExtensionId()` returns the next id to be allocated.
 */
export const FIRST_PUBLIC_EXTENSION_ID = 0x10000n;

export const client = createPublicClient({
  chain: coston2,
  transport: http(undefined, { batch: true, retryCount: 3, timeout: 30_000 }),
});

/** Only the facet methods Reprod actually calls, hand-written from the ABIs. */
export const teeAbi = [
  {
    type: "function",
    name: "getAllActiveTeeMachines",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      { name: "teeIds", type: "address[]" },
      { name: "urls", type: "string[]" },
      { name: "total", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getTeeMachineWithAttestationData",
    stateMutability: "view",
    inputs: [{ name: "teeId", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "teeId", type: "address" },
          { name: "initialTeeId", type: "address" },
          { name: "url", type: "string" },
          { name: "codeHash", type: "bytes32" },
          { name: "platform", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getTeeMachineStatus",
    stateMutability: "view",
    inputs: [{ name: "teeId", type: "address" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getExtensionId",
    stateMutability: "view",
    inputs: [{ name: "teeId", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTeeMachineOwner",
    stateMutability: "view",
    inputs: [{ name: "teeId", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getSystemSupportedPlatforms",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "nextPublicExtensionId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSupportedCodeHashes",
    stateMutability: "view",
    inputs: [{ name: "extensionId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "getExtensionOwner",
    stateMutability: "view",
    inputs: [{ name: "extensionId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * The simulated code hash. A machine carrying this is attested, but attested to
 * a simulator — it binds to no source code at all. Documented in the FCC
 * getting-started guide as the expected value when `SIMULATED_TEE=true`.
 */
export const SIMULATED_CODE_HASH_PREFIX = "0x194844cf";

/** Machine status enum, from IMachineManager. */
export const MACHINE_STATUS = ["UNKNOWN", "INITIALIZED", "PRODUCTION", "PAUSED", "BANNED"] as const;
export type MachineStatus = (typeof MACHINE_STATUS)[number];

export function statusName(n: number): MachineStatus | `UNMAPPED_${number}` {
  return MACHINE_STATUS[n] ?? (`UNMAPPED_${n}` as const);
}

/** Decode a right-padded bytes32 string (Solidity `bytes32("GCP_AMD_SEV")`). */
export function bytes32ToString(hex: Hex): string {
  const body = hex.slice(2).replace(/(00)+$/u, "");
  if (body.length === 0) return "";
  const bytes = body.match(/.{1,2}/gu) ?? [];
  return bytes
    .map((b) => String.fromCharCode(parseInt(b, 16)))
    .join("")
    .replace(/\0+$/u, "");
}
