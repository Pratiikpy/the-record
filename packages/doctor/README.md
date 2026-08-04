# doctor

**Why is this TEE machine not working?**

191 of the 223 machines registered on Coston2 are unreachable, and FCC's failure
modes are documented as silent — a machine sits at `INITIALIZED` forever, or
instructions simply never arrive, with no error surface anywhere.

```bash
pnpm -C packages/doctor run doctor 0xE3829862…0b20   # one machine
pnpm -C packages/doctor run doctor --worst 5          # the most broken
```

Reads `packages/reprod/out/scan.json`. No keys, no network of its own.

## The diagnosis is deterministic

Every finding is a rule over facts read from the chain and from a live probe:

| Finding | Severity | Fires when |
|---|---|---|
| `URL_ROTATED` | blocker | dead, and the host is a tunnel whose address rotates |
| `PROXY_UNREACHABLE` | blocker | dead on a stable host |
| `NEVER_REACHED_PRODUCTION` | blocker | status is `INITIALIZED` |
| `SUSPENDED` | blocker | status is `PAUSED` or `BANNED` |
| `SELF_REPORT_MISMATCH` | blocker | the proxy reports a different code hash than the chain |
| `PLAINTEXT_PROXY` | warning | served over plain `http://` |
| `SIMULATED` | note | attested to a simulator — legitimate, but binds to no source |
| `SHARED_PROXY` | note | several machines share the URL, so no drift check is possible |
| `SLOW_PROXY` | note | `/info` took over a second |

Every blocker carries a fix. That is asserted by a test.

## The prose is not the product

With `ZEROG_API_KEY` set, `doctor` adds a plain-English paragraph, generated on
[0G Private Computer](https://0g.ai) (TEE-attested inference, OpenAI-compatible
at `router-api.0g.ai/v1`). The model is given the findings and told it may not
add to them.

**Without a key, nothing about the diagnosis changes.** A diagnostic that
depends on a language model for its conclusions is not a diagnostic, so the
dependency runs the other way: prose is a convenience layer that can fail, time
out or be absent entirely, and a test asserts the findings are byte-identical
either way.

### Where generated text may not go

- **Not on a register page.** Covenant, Procedure and Reprod exist to carry
  facts that cannot be self-asserted. Generated prose is the opposite of that,
  and mixing the two would undermine the only thing they are for.
- **Not on chain, and never attested.** FDC's `Web2Json` requires byte-identical
  responses across independent attestors; model output is not deterministic, so
  the request would fail consensus silently with no error surface.
- **Not in the trust path.** 0G's enclave is not Flare's. Layer 2 is about what
  a *Flare* TEE can attest.

## Configuration

```bash
cp .env.example .env      # at the repo root
# ZEROG_API_KEY=sk-…
# ZEROG_BASE_URL=https://router-api.0g.ai/v1
# ZEROG_MODEL=deepseek-v4-flash   (optional)
```

`.env` is gitignored. The key is never committed and never printed.
