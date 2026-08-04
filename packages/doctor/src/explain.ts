/**
 * Optional prose layer over a deterministic diagnosis.
 *
 * Runs on 0G Private Computer (TEE-attested inference, OpenAI-compatible at
 * router-api.0g.ai/v1).
 *
 * ⚠ WHERE THIS MAY AND MAY NOT BE USED.
 *
 * It may phrase findings for a developer reading a terminal. It may NOT appear
 * on any register page, be recorded on chain, or be attested. The registers
 * exist to carry facts that cannot be self-asserted; generated prose is the
 * opposite of that, and mixing the two would undermine the only thing they are
 * for.
 *
 * It also must never be attested through FDC. Web2Json requires byte-identical
 * responses across independent attestors, and model output is not deterministic
 * — the request would fail consensus silently, with no error surface.
 *
 * The model is given the findings and told it may not add to them. That is a
 * mitigation, not a guarantee, which is exactly why nothing downstream depends
 * on it: `doctor` prints the deterministic diagnosis with or without this.
 */
import type { Finding } from "./diagnose.js";

const DEFAULT_MODEL = "deepseek-v4-flash";

export interface ExplainOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ExplainResult {
  ok: boolean;
  /** present only on success */
  text?: string;
  /** why prose is unavailable — never fatal */
  reason?: string;
  model?: string;
}

const SYSTEM = `You explain diagnostic findings about a Flare Confidential Compute TEE machine to the developer who runs it.

Rules, without exception:
- Use ONLY the findings given. Do not add causes, steps, or context that are not in them.
- If the findings do not explain something, say the findings do not cover it.
- No preamble, no summary of what you are about to do, no sign-off.
- At most 120 words. Plain sentences. British spelling.
- Lead with what is actually broken and what to do first.
- Never invent an address, hash, number, command flag or file name.`;

export async function explain(
  findings: readonly Finding[],
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  // An empty string counts as absent. `??` alone would treat "" as a real key
  // and attempt an authenticated call that can only fail.
  const apiKey = opts.apiKey || process.env.ZEROG_API_KEY || "";
  const baseUrl = opts.baseUrl ?? process.env.ZEROG_BASE_URL ?? "https://router-api.0g.ai/v1";
  const model = opts.model ?? process.env.ZEROG_MODEL ?? DEFAULT_MODEL;

  if (!apiKey) {
    return { ok: false, reason: "ZEROG_API_KEY not set — deterministic diagnosis only" };
  }
  if (findings.length === 0) {
    return { ok: false, reason: "nothing to explain" };
  }

  const facts = findings
    .map(
      (f) =>
        `[${f.severity}] ${f.title}\n  observed: ${f.observed}${f.fix ? `\n  fix: ${f.fix}` : ""}`,
    )
    .join("\n\n");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Findings:\n\n${facts}` },
        ],
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 160)}`, model };
    }
    if (!body.trimStart().startsWith("{")) {
      return { ok: false, reason: `non-JSON response: ${body.slice(0, 120)}`, model };
    }

    const json = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, reason: "empty completion", model };

    return { ok: true, text, model };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e);
    return { ok: false, reason: msg, model };
  } finally {
    clearTimeout(timer);
  }
}
