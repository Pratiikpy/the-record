# Evidence log — Reprod scan #1

**Coston2 (chain 114), block 33,607,820 · 2026-08-04**

Everything below was read off the live chain or probed over the public internet.
No credentials, no funding, no permission from anyone. Regenerate with
`pnpm run build` in `packages/reprod`.

---

## What the register says

| | |
|---|---|
| Active TEE machines | **223** |
| Distinct extensions | 191 |
| Public extension ids allocated | 65,930 − 65,536 = **394** |
| Distinct code hashes | 8 |
| Unique proxy URLs | 89 |

### Attestation

| Verdict | Count | Share |
|---|---|---|
| SIMULATED | **215** | 96% |
| NO_KNOWN_SOURCE | **8** | 4% |
| REPRODUCED / DIVERGED / UNREPRODUCIBLE | 0 | — |

215 of 223 machines carry a single shared code hash,
`0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2`, on
`TEST_PLATFORM`. That is the documented `SIMULATED_TEE=true` constant. It is a
legitimate development mode — and it binds to no source code whatsoever.

### Liveness

| State | Count | Share |
|---|---|---|
| DEAD | **191** | 86% |
| LIVE | 32 | 14% |

**86% of everything registered is unreachable.** 72 of 89 proxy URLs sit on hosts
whose addresses rotate by design — Cloudflare quick tunnels, free ngrok, GitHub
Codespaces, Railway. Those registrations are expected to rot, and they have.
6 proxies are served over plain `http://` to a raw IP.

---

## The headline

> **Every machine running on real confidential hardware in Flare's Coston2
> network — all eight of them — runs code that no third party has ever
> independently reproduced.**

All 8 are `NO_KNOWN_SOURCE` and all 8 are LIVE.

| Machine | Ext | Platform | Proxy |
|---|---|---|---|
| `0x4B2a6A16…2A0E` | 65680 | GCP_INTEL_TDX | 34.6.157.25 *(http)* |
| `0xb200efde…7981` | 65680 | GCP_INTEL_TDX | 34.6.157.25 *(http)* |
| `0x9758E670…Fb87` | 0 | GCP_AMD_SEV | tee-proxy-coston2-1.flare.rocks |
| `0xC869a5db…57C5` | 0 | GCP_AMD_SEV | tee-proxy-coston2-1.flare.rocks |
| `0x7Dd44c7F…4c2f` | 0 | GCP_AMD_SEV | tee-proxy-coston2-2.flare.rocks |
| `0x38609FbE…fD20` | 65814 | GCP_AMD_SEV | tee-proxy-coston2-ian.flare.rocks |
| `0xf8b6f452…9C15` | 65834 | GCP_AMD_SEV | tee-proxy-coston2-orderbook.flare.rocks |
| `0xBA37bf78…4DFD` | 65871 | GCP_AMD_SEV | tee-proxy-coston2-orderbook.flare.rocks |

This is not an accusation. It is the gap Flare's own tooling already documents,
verbatim, in `fce-extension-scaffold/tools/cmd/allow-tee-version/main.go`:

> `NOTE: Code hash is from proxy /info response — not independently verified against attestation`

Reprod exists to close it.

---

## Corrections we made to our own findings

Recorded because a register that cannot correct itself is not evidence.

**① A first scan reported "4 self-report mismatches". There are zero.**
Liveness is probed once per unique URL, but a proxy serves a single `/info` and
many machines share one URL. Comparing that shared response against each
machine's own on-chain hash manufactured false mismatches. Fixed: a comparison
is only asserted when exactly one machine is registered at a URL. Of 223
machines, **12 could be compared one-to-one, and all 12 agreed with the chain.**
The other 20 live machines are recorded as `AMBIGUOUS`, never as drift.

**② A first scan covered 200 of 223 machines.**
`getAllActiveTeeMachines(start, count)` does not paginate as its signature
suggests — `start=200` returns an empty array even though the total is 223.
Verified directly against the contract. The scanner now reads the total first,
requests the whole set from `start=0`, and **throws rather than publish a
partial register**.

**③ Sort order buried the only rows that matter.**
Severity originally ranked `SIMULATED + LIVE` above real hardware, pushing all 8
real machines below 215 dev machines. Simulated is someone developing, not a
finding. Real hardware now outranks it in every combination, guarded by a
regression test.

---

## Verified facts about the stack

- TEE ids are **addresses**, not `bytes32`.
- `getTeeMachineWithAttestationData(address)` returns
  `(teeId, initialTeeId, url, codeHash, platform)`.
- System platforms are exactly four: `GCP_INTEL_TDX`, `GCP_AMD_SEV`,
  `GCP_AMD_SEV_ES`, `TEST_PLATFORM`.
- `FlareTeeManager` on Coston2 is a diamond at
  `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`; unknown selectors revert with
  `FunctionNotFound(bytes4)` (`0x5416eb98`).

## Accessibility findings on our own page

Measured in-browser, not assumed. The inherited `--faint` (`#8A867F`) scored
**3.44:1** on paper — below the 4.5:1 AA floor — while carrying table column
headers, stat labels, figure captions and the 10.5px sublines. Dark mode scored
4.18:1. Both replaced (`#757068` → 4.72:1, `#8C867A` → 5.13:1) and locked behind
a test that parses the *rendered* stylesheet, so editing the renderer without
fixing the tokens fails the build.

The page also shipped without a viewport meta tag, so mobile laid out at 980px
and no breakpoint fired. Fixed and verified at 390×844.

---

---

# Evidence log — Covenant scan #1

**Coston2 · AssetManagerFXRP `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`**
**Blocks 33,408,308 → 33,608,308 (200,000 blocks) · 26,075 logs**

## The load-bearing question, answered

`redemptionPaymentDefault` is permissioned to the redeemer, the agent, or **the
executor appointed at `redeem()` time**. So Layer 1 hinges on one number: how
many real redemptions actually name an executor?

| | |
|---|---|
| Redemptions requested | 2,363 |
| Performed | 2,265 (95.9%) |
| Defaulted | **0** |
| Still open | 98 |
| **Named an executor** | **2,017 — 85.36%** |
| Distinct agents | 4 |

**85% already delegate.** The executor role is not theoretical and not
unused — it is the norm, and there is a live fee market to enter. Layer 1 does
not have to create the behaviour, only serve it better.

## The other half of that answer, which is bad news

**Zero defaults in 200,000 blocks.** Agents on Coston2 are performing. So the
auto-claim relay has, right now, nothing whatsoever to claim.

This confirms empirically the "quiet testnet" trap flagged during planning: a
recovery product whose demo depends on organic failure has no demo. The
adversarial fixture generator — deliberately manufacturing each documented
failure mode on Coston2 — is therefore **required**, not a nice-to-have, and
the historical replay must run against Songbird and mainnet where real defaults
exist.

## ⚠ Documentation bug found in Flare's published reference

`docs/fassets/reference/IAssetManagerEvents.mdx` declares:

```solidity
event RedemptionPerformed(
    address indexed agentVault,
    address indexed redeemer,
    uint64 indexed requestId,   // ← uint256 on chain
    ...
```

The deployed contract emits `uint256`. Because an event selector is a hash of
its canonical signature, the documented form yields a topic0 that matches
nothing. **An indexer built faithfully from the published reference decodes zero
completions and reports every redemption as permanently open** — which is
exactly what happened here on the first run: 2,352 requested, 0 performed.

Confirmed by counting topic0 frequency over 60,000 blocks (`src/topics.ts`):

| topic0 | signature | count |
|---|---|---|
| `0xd5150395…ccc3331` | `RedemptionPerformed(address,address,uint256,bytes32,uint256,int256)` | **626** |
| — | `…uint64…` variant | **0** |

Both selectors are now locked behind a regression test (`test/events.test.ts`).
Worth an upstream PR to `flare-foundation/developer-hub`.

## Infrastructure constraint worth publishing

Every public Coston2 RPC caps `eth_getLogs`, and they disagree by 33×:

| Endpoint | Max blocks per request |
|---|---|
| `flare-testnet-coston2.rpc.thirdweb.com` | **1,000** |
| `coston2.enosys.global` | 350 (100 under load) |
| `coston2-api.flare.network` | **30** |
| `rpc.ankr.com/flare_coston2` | refuses, no number given |

The official endpoint's 30-block cap means a 200k-block scan needs ~6,700
requests. The scanner therefore probes each endpoint at runtime, adopts the
widest window, and fails over mid-sweep when one starts throttling — thirdweb
returns a plain-text rate-limit body rather than JSON-RPC, which crashes a naive
client with `Unexpected token 'Y'`.

---

# Evidence log — first independent rebuild

**`flare-foundation/tee-node@v0.0.24` (`adc67a29…`) · 2026-08-04**

Rebuilt from source on a machine with no relationship to Flare, using their own
published recipe, **twice**, with `--no-cache`:

```
docker buildx build --builder moby-buildkit --platform linux/amd64 --no-cache \
  --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  --output type=docker,rewrite-timestamp=true
```

Both builds produced an identical OCI image config digest in 232s:

```
0x7b096a01a1974dbcb0598b51b9de67f35b36c201e2ff65bbf5078b0785dc35bb
```

**The core mechanism works.** Layer 3's load-bearing risk — "if builds don't
actually reproduce, DIVERGED becomes noise and the register is worse than
nothing" — does not fire on the Go path.

## The verdict is DETERMINISTIC, not REPRODUCED

Recorded honestly, and the vocabulary was corrected mid-build to enforce it:

- **DETERMINISTIC** — the source builds to the same digest twice. That is all
  this run establishes.
- **REPRODUCED** — the digest additionally *matches a codeHash a machine is
  actually registered with on chain*.

Only the second is evidence about a running machine. The type now makes
`REPRODUCED` impossible to construct without the on-chain hash it matched
(`test/rebuild.test.ts`), so the register cannot claim verification it never
performed.

## Two mechanics that are easy to get silently wrong

**The default Docker driver does not honour `rewrite-timestamp`**
([moby/buildkit#4230](https://github.com/moby/buildkit/issues/4230)). Building
with it yields a digest that differs run to run, which reads as DIVERGED and is
pure noise. The runner asserts the `docker-container` driver and refuses
otherwise.

**The identifier is the OCI image *config* digest** — the value Confidential
Space reports as `submods.container.image_id`. `docker inspect .Id` returns it
under the docker driver, but its meaning shifts with the storage backend.

## Flare states the limitation themselves

From `fce-extension-scaffold/REPRODUCIBILITY.md`, which is the strongest
possible corroboration of why this layer needs to exist:

| Language | Guarantee |
|---|---|
| **Go** | **Bit-for-bit across machines** |
| Python | Same-machine only |
| TypeScript | Same-machine only |

> "For Python and TypeScript … it does **not** mean an auditor on different
> hardware can independently reproduce your hash."
>
> "If independent third-party verification of the code hash matters for your
> deployment, use the Go path."

They also flag an outstanding action item: the Python and TypeScript runtime
base images are still pinned by tag rather than `sha256` digest, marked `NOTE:`
in their Dockerfiles — "required before cutting a testnet release."

So a Python or TypeScript extension registered today **cannot** be independently
verified by anyone, by Flare's own account. Reprod reports that as
`UNREPRODUCIBLE`, which is precisely the verdict that must not be collapsed
into `DIVERGED`.

---

## Reproduce this

```bash
cd packages/reprod
pnpm install
pnpm run build      # scan + render
pnpm run test       # 52 tests: classification, URL assessment, contrast, encoding
```

Outputs `out/scan.json` (every field above) and `out/index.html` (the register).
