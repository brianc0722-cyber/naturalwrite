import type { AiOpinion } from "@/db/schema";

/**
 * Optional generative-AI "second opinion" for the originality scanner.
 *
 * Activates ONLY when OPENAI_API_KEY is configured in the environment
 * (works with any OpenAI-compatible API via OPENAI_BASE_URL / OPENAI_MODEL).
 * Without a key it returns null and the scanner runs purely on heuristics —
 * nothing is sent to any external service.
 */

const SYSTEM_PROMPT = `You are an expert forensic detector of AI-generated text. You analyze writing samples and judge how likely they are to have been produced by a large language model rather than a human.

Look for: stock AI phrases, uniform sentence rhythm, formulaic transitions, excessive hedging, absence of personal voice or contractions, template parallel structures, vague abstractions without concrete detail.

Respond with ONLY a JSON object in this exact shape, no markdown, no extra text:
{"score": <integer 0-100 probability the text is AI-generated>, "verdict": "<Likely human|Mixed|Likely AI>", "reasoning": "<2-3 plain sentences explaining your judgment>", "flags": ["<short specific observed pattern>", ...up to 5 items]}`;

/**
 * Hosts the API key may be sent to.
 *
 * Without this, anyone able to set OPENAI_BASE_URL could point the app at a
 * server they control and harvest OPENAI_API_KEY from the Authorization
 * header. Setting environment variables is already a privileged action, so
 * this is defense in depth rather than a hole being closed — but the check is
 * nearly free.
 *
 * Self-hosters using a local or alternative OpenAI-compatible endpoint can add
 * their host here, or set OPENAI_BASE_URL_ALLOW_ANY=1 to opt out deliberately.
 */
const DEFAULT_ALLOWED_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "openrouter.ai",
  "api.groq.com",
  "api.mistral.ai",
  "api.together.xyz",
  "generativelanguage.googleapis.com",
];

/**
 * Returns a safe base URL, or null when the configured one is not acceptable.
 * Exported for testing.
 */
export function resolveBaseUrl(
  raw: string | undefined,
  allowAny: boolean,
): string | null {
  const candidate = (raw || "https://api.openai.com/v1").trim();

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // Never transmit a bearer token in cleartext. localhost is exempt because a
  // loopback endpoint never leaves the machine.
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !isLoopback) return null;

  if (allowAny || isLoopback) return candidate.replace(/\/$/, "");

  const host = url.hostname.toLowerCase();
  const permitted = DEFAULT_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
  if (!permitted) return null;

  return candidate.replace(/\/$/, "");
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    const obj = JSON.parse(s.slice(first, last + 1));
    return typeof obj === "object" && obj !== null ? obj : null;
  } catch {
    return null;
  }
}

export async function getAiSecondOpinion(
  text: string,
  heuristicScore: number,
): Promise<AiOpinion> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const base = resolveBaseUrl(
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_BASE_URL_ALLOW_ANY === "1",
  );
  if (base === null) {
    console.error(
      "LLM second opinion skipped: OPENAI_BASE_URL is not an allowed https endpoint. Set OPENAI_BASE_URL_ALLOW_ANY=1 to override.",
    );
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const truncated =
    text.length > 14_000 ? `${text.slice(0, 14_000)}\n[truncated]` : text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `A heuristic pre-screen scored this text ${heuristicScore}/100 for AI-likeness. Use it only as a prior; make your own judgment.\n\nWriting to analyze:\n"""\n${truncated}\n"""`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("LLM second opinion HTTP", res.status);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonLoose(raw);
    if (!parsed) return null;

    const verdictRaw = String(parsed.verdict ?? "");
    const verdict = /likely human/i.test(verdictRaw)
      ? "Likely human"
      : /mixed/i.test(verdictRaw)
        ? "Mixed"
        : /likely ai/i.test(verdictRaw)
          ? "Likely AI"
          : "Mixed";

    const flags = Array.isArray(parsed.flags)
      ? parsed.flags.map((f) => String(f)).slice(0, 5)
      : [];

    return {
      model,
      score: clampScore(Number(parsed.score)),
      verdict,
      reasoning: String(parsed.reasoning ?? "").slice(0, 600),
      flags,
    };
  } catch (err) {
    console.error("LLM second opinion failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
