# Deployments

Everything here is verifiable with one `cast` call. Nothing is asserted that a
reader cannot check.

## Networks

| Role | Network | Chain | Why |
|---|---|---|---|
| Subject | **Flare Mainnet** | 14 | Where real value settles. CV-1 only reads, so this costs nothing and risks nothing. |
| Fault laboratory | **Coston2** | 114 | Where faults are injected deliberately. Must be requested by name (`NETWORK=coston2`). |
| Contracts | **Coston2** | 114 | The registries. |

## Contracts (Coston2)

| Contract | Address | Deploy tx |
|---|---|---|
| `AssuranceRegistry` | `0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439` | `0xc25f495b116c5a54392190d3dec963fd626d5926ec81ebf55d06009d6471c5d0` |
| `ReproRegistry` | `0x7EfCBb20DC125A8322FCF862C04AcF97b0c1f70B` | `0x7589f44fb782fc8b67dd123708abb35d378d4987f2b8ec8a94b421dc205518bb` |
| `FailRecord` | `0x5f623912D4dFA8d4d702cA77754a3517B4FA4c56` | `0x4d2e97f15aa7545f7d291cd37f8c938306aa7eeb1316aa145c361542039fca5e` |

Admin on all three: `0xBfAb976460eCD399ac695a395F44B359339c2F8c`.

## CV-1 on chain

The procedure is registered against the **mainnet** Core Vault manager as its
subject, and period 0 is concluded.

| Field | Value |
|---|---|
| Procedure id | `0x72c9a9c291cbcaecfbdbb925235ca114c4d85aad22453bd31e30be4c11856564` |
| Subject | `0x6c8d96dEfE4cbEE05FA969Fc0Ac436d94Fc21784` (Flare **mainnet** CoreVaultManager) |
| Period length | 86,400s · grace 21,600s |
| Opinion | `1` = **CLEAN** |
| Evidence digest | `0x77377318` |
| Register tx | `0xd323d91baa52d96967e474e0097e9d2b55e879da1c09fdbd1ee4a86fa47966bc` |
| Conclude tx | `0x337876df77aefd96bfe076ff076f814baa09e6038ebc86b5e9cfab5c86e7554d` |

Read it back yourself:

```sh
cast call --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  0x0D4ccD24cC8E2517d4C88a0739648a7ed4196439 \
  "conclusionOf(bytes32,uint64)(uint8,bytes32,uint32,uint64,address)" \
  0x72c9a9c291cbcaecfbdbb925235ca114c4d85aad22453bd31e30be4c11856564 0
```

`lapse()` is permissionless. Once the grace window closes on a period nobody
concluded, any address can write the adverse record — suppression becomes the
record rather than a gap in it.

## Read targets on Flare mainnet

Resolved at run time through the contract registry, never hardcoded.

| Contract | Address |
|---|---|
| Contract Registry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| AssetManagerController | `0x097B93eEBe9b76f2611e1E7D9665a9d7Ff5280B3` |
| AssetManager (FXRP) | `0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8` |
| CoreVaultManager | `0x6c8d96dEfE4cbEE05FA969Fc0Ac436d94Fc21784` |
| Core Vault (XRPL) | `rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj` |
| Custodian (XRPL) | `rMLNvZR9dascY5jtCfCv3whAp8HdUSZAQ` |

## Coston2 read targets

| Contract | Address |
|---|---|
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |
| AssetManagerFXRP | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| CoreVaultManager | `0x4CB40b0dBfbF239eC60C9bE1496A6c1aA29e429b` |
