import type { Address } from "viem";

/**
 * AssetManagerFXRP on Coston2, resolved from the Flare ContractRegistry at
 * 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019 via getAllContracts().
 *
 * Lives here rather than in scan.ts so that importing the address does not
 * execute a scan — modules with side effects at import time make every tool
 * that touches them unusable.
 */
export const ASSET_MANAGER_FXRP: Address = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
export const ASSET_MANAGER_CONTROLLER: Address = "0x1C772F700308aF4c13897cc7b9c41EFfB82c50C0";
export const MASTER_ACCOUNT_CONTROLLER: Address = "0x434936d47503353f06750Db1A444DBDC5F0AD37c";
export const FLARE_CONTRACT_REGISTRY: Address = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
