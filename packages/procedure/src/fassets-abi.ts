/**
 * The FAssets AssetManager ABI fragments AB-1 needs.
 *
 * The manager is an EIP-2535 diamond, so `getAgentInfo` is not on the proxy's
 * own verified ABI -- it lives in a facet. This struct was taken from the
 * verified facet rather than hand-written, because a mis-declared tuple decodes
 * silently into plausible-looking wrong numbers, which is the failure mode this
 * project exists to catch.
 */
export const managerAbi = [
  { type: "function", name: "fAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "getAllAgents",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "getAgentInfo",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "ownerManagementAddress", type: "address" },
          { name: "ownerWorkAddress", type: "address" },
          { name: "collateralPool", type: "address" },
          { name: "collateralPoolToken", type: "address" },
          { name: "underlyingAddressString", type: "string" },
          { name: "publiclyAvailable", type: "bool" },
          { name: "feeBIPS", type: "uint256" },
          { name: "poolFeeShareBIPS", type: "uint256" },
          { name: "vaultCollateralToken", type: "address" },
          { name: "mintingVaultCollateralRatioBIPS", type: "uint256" },
          { name: "mintingPoolCollateralRatioBIPS", type: "uint256" },
          { name: "freeCollateralLots", type: "uint256" },
          { name: "totalVaultCollateralWei", type: "uint256" },
          { name: "freeVaultCollateralWei", type: "uint256" },
          { name: "vaultCollateralRatioBIPS", type: "uint256" },
          { name: "poolWNatToken", type: "address" },
          { name: "totalPoolCollateralNATWei", type: "uint256" },
          { name: "freePoolCollateralNATWei", type: "uint256" },
          { name: "poolCollateralRatioBIPS", type: "uint256" },
          { name: "totalAgentPoolTokensWei", type: "uint256" },
          { name: "announcedVaultCollateralWithdrawalWei", type: "uint256" },
          { name: "announcedPoolTokensWithdrawalWei", type: "uint256" },
          { name: "freeAgentPoolTokensWei", type: "uint256" },
          { name: "mintedUBA", type: "uint256" },
          { name: "reservedUBA", type: "uint256" },
          { name: "redeemingUBA", type: "uint256" },
          { name: "poolRedeemingUBA", type: "uint256" },
          { name: "dustUBA", type: "uint256" },
          { name: "liquidationStartTimestamp", type: "uint256" },
          { name: "maxLiquidationAmountUBA", type: "uint256" },
          { name: "liquidationPaymentFactorVaultBIPS", type: "uint256" },
          { name: "liquidationPaymentFactorPoolBIPS", type: "uint256" },
          { name: "underlyingBalanceUBA", type: "int256" },
          { name: "requiredUnderlyingBalanceUBA", type: "uint256" },
          { name: "freeUnderlyingBalanceUBA", type: "int256" },
          { name: "announcedUnderlyingWithdrawalId", type: "uint256" },
          { name: "buyFAssetByAgentFactorBIPS", type: "uint256" },
          { name: "poolExitCollateralRatioBIPS", type: "uint256" },
          { name: "redemptionPoolFeeShareBIPS", type: "uint256" },
        ],
      },
    ],
  },
] as const;
