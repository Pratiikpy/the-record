/**
 * FAssets redemption lifecycle events.
 *
 * Signatures transcribed from the official IAssetManagerEvents reference.
 *
 * ⚠ THE PUBLISHED DOCS ARE WRONG ABOUT RedemptionPerformed.
 *
 * `IAssetManagerEvents.mdx` declares `uint64 indexed requestId` for
 * RedemptionPerformed. The deployed AssetManagerFXRP on Coston2 emits
 * `uint256`. Because the event selector is a hash of the canonical signature,
 * the uint64 form yields a topic0 that never matches anything on chain — an
 * indexer built from the published reference silently decodes ZERO completions
 * and concludes every redemption is still open.
 *
 * Verified by counting topic0 frequencies against both candidates over 60,000
 * blocks (`src/topics.ts`):
 *
 *   0xd5150395b21c5be6cbb37ea167761efe7a013baccbd1bb7e5922fa261ccc3331
 *     = RedemptionPerformed(address,address,uint256,bytes32,uint256,int256)
 *     = 626 occurrences
 *   the uint64 variant = 0 occurrences
 *
 * The uint256 form is used here. Reported upstream; see docs/EVIDENCE.md.
 */
export const redemptionEvents = [
  {
    type: "event",
    name: "RedemptionRequested",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "paymentAddress", type: "string", indexed: false },
      { name: "valueUBA", type: "uint256", indexed: false },
      { name: "feeUBA", type: "uint256", indexed: false },
      { name: "firstUnderlyingBlock", type: "uint256", indexed: false },
      { name: "lastUnderlyingBlock", type: "uint256", indexed: false },
      { name: "lastUnderlyingTimestamp", type: "uint256", indexed: false },
      { name: "paymentReference", type: "bytes32", indexed: false },
      { name: "executor", type: "address", indexed: false },
      { name: "executorFeeNatWei", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedemptionPerformed",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      // uint256 on chain, NOT uint64 as the reference docs claim — see header.
      { name: "requestId", type: "uint256", indexed: true },
      { name: "transactionHash", type: "bytes32", indexed: false },
      { name: "redemptionAmountUBA", type: "uint256", indexed: false },
      { name: "spentUnderlyingUBA", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedemptionDefault",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "redemptionAmountUBA", type: "uint256", indexed: false },
      { name: "redeemedVaultCollateralWei", type: "uint256", indexed: false },
      { name: "redeemedPoolCollateralWei", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedemptionPaymentFailed",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "transactionHash", type: "bytes32", indexed: false },
      { name: "spentUnderlyingUBA", type: "int256", indexed: false },
      { name: "failureReason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedemptionPaymentBlocked",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "transactionHash", type: "bytes32", indexed: false },
      { name: "spentUnderlyingUBA", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedemptionRejected",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "valueUBA", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Events that close a redemption. Anything without one of these is in flight. */
export const TERMINAL_EVENTS = [
  "RedemptionPerformed",
  "RedemptionDefault",
  "RedemptionPaymentFailed",
  "RedemptionPaymentBlocked",
  "RedemptionRejected",
] as const;

export type TerminalEvent = (typeof TERMINAL_EVENTS)[number];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
