/**
 * Live Coston2 addresses, in their own module.
 *
 * These sat in `run.ts` next to a top-level `main()`. Importing them from the
 * red-run script therefore executed a full live procedure run as a side effect —
 * harmless-looking, but it meant two different chains were being read in one
 * process while the log implied one. Constants live somewhere importable.
 */
import type { Address } from "viem";

/** Resolved from AssetManagerFXRP.getCoreVaultManager() on Coston2. */
export const CORE_VAULT_MANAGER: Address = "0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b";
export const ASSET_MANAGER_FXRP: Address = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
