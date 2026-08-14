import { resolveBaseUrl } from "@/lib/llm-opinion";
import type { GrammarIssue } from "@/lib/grammar";

/**
 * Optional LLM grammar pass, layered on top of the deterministic rules.
 *
 * Same contract as `llm-opinion.ts`: activates ONLY when OPENAI_API_KEY is
 * set, returns null on every failure path, and never throws into the route.
 * Without a key the grammar tab still works — it just shows rule findings
 * alone, and the UI says so rather than implying a deeper check happened.
 *
 * The division of labour matters. The rule engine owns mechanics, where it is
 * exact and free. The model is asked for what rules genuinely cannot do:
 * agreement across clauses, tense consistency, wrong-word errors that are
 * spelled correctly, and dangling modifiers. Asking it to re-report doubled
 * words would just duplicate findings and burn tokens.
 *
 * Offsets are resolved locally by searching for the returned excerpt. Models
 * cannot count characters reliably, so any position they report is fiction;
 * an excerpt that cannot be found verbatim is dropped rather than guessed at.
 */

const SYSTEM_PROMPT = `You are a meticulous copy editor. You find genuine grammatical errors in text and report them as structured data.

Report ONLY these categories:
- Subject-verb agreement across intervening clauses
- Verb tense inconsistency within a passage
- Pronoun-antecedent disagreement or ambiguous reference
- Dangling or misplaced modifiers
- Wrong word that is spelled correctly (malapropisms, confused homophones)
- Missing or incorrect prepositions and articles that change meaning
- Comma splices and run-on sentences
- Faulty parallelism in lists or series

Do NOT report: doubled words, spacing, capitalization at sentence start, repeated punctuation, passive voice, sentence length, wordiness, or style preferences. Those are handled elsewhere and duplicates are discarded.

Be conservative. If a construction is defensible in edited prose, do not report it. Dialect, deliberate fragments in creative writing, and technical jargon are not errors.

Respond with ONLY a JSON object, no markdown:
{"issues": [{"excerpt": "<the exact text containing the error, copied verbatim, 2-12 words>", "correction": "<the corrected version of that same span>", "explanation": "<one plain sentence>", "kind": "<agreement|tense|pronoun|modifier|word-choice|preposition|run-on|parallelism>"}]}

Return {"issues": []} when the writing is grammatically sound.`;

const MAX_CHARS = 14_000;
const MAX_ISSUES = 25;
const TIMEOUT_MS = 20_000;

export type LlmGrammarReview = {
  model: string;
  issues: GrammarIssue[];
  /** True when the text was cut before sending. */
  truncated: boolean;
} | null;

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

/**
 * Finds the excerpt in the source text and returns its span.
 *
 * Tries verbatim first, then a whitespace-tolerant match, because models
 * routinely normalise runs of spaces and line breaks when quoting. Returns
 * null when the excerpt is not genuinely present — a hallucinated quote must
 * never be shown as a highlighted span.
 */
export function locateExcerpt(
  text: string,
  excerpt: string,
  fromIndex = 0,
): { offset: number; length: number } | null {
  const trimmed = excerpt.trim();
  if (trimmed.length < 2) return null;

  const direct = text.indexOf(trimmed, fromIndex);
  if (direct !== -1) return { offset: direct, length: trimmed.length };

  const fresh = text.indexOf(trimmed);
  if (fresh !== -1) return { offset: fresh, length: trimmed.length };

  // Whitespace-tolerant: build a pattern where any run of whitespace in the
  // excerpt matches any run in the source.
  const escaped = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  try {
    const m = new RegExp(escaped).exec(text);
    if (m) return { offset: m.index, length: m[0].length };
  } catch {
    return null;
  }
  return null;
}

const KIND_LABEL: Record<string, string> = {
  agreement: "Agreement",
  tense: "Tense",
  pronoun: "Pronoun reference",
  modifier: "Modifier",
  "word-choice": "Word choice",
  preposition: "Preposition",
  "run-on": "Run-on sentence",
  parallelism: "Parallelism",
};

export async function getLlmGrammarReview(
  text: string,
): Promise<LlmGrammarReview> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const base = resolveBaseUrl(
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_BASE_URL_ALLOW_ANY === "1",
  );
  if (base === null) {
    console.error(
      "LLM grammar review skipped: OPENAI_BASE_URL is not an allowed https endpoint.",
    );
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const truncated = text.length > MAX_CHARS;
  const payload = truncated ? text.slice(0, MAX_CHARS) : text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
            content: `Find grammatical errors in the following text.\n\n"""\n${payload}\n"""`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("LLM grammar review HTTP", res.status);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = parseJsonLoose(data.choices?.[0]?.message?.content ?? "");
    if (!parsed) return null;

    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues: GrammarIssue[] = [];
    let cursor = 0;

    for (const entry of rawIssues.slice(0, MAX_ISSUES)) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const excerpt = String(e.excerpt ?? "").trim();
      if (!excerpt) continue;

      const span = locateExcerpt(payload, excerpt, cursor);
      if (!span) continue; // not actually in the text — discard
      cursor = span.offset + span.length;

      const kind = String(e.kind ?? "").toLowerCase();
      const label = KIND_LABEL[kind] ?? "Grammar";
      const correction = String(e.correction ?? "").trim();

      issues.push({
        rule: `llm-${kind || "grammar"}`,
        category: "grammar",
        severity: "warning",
        message: `${label}: ${String(e.explanation ?? "").slice(0, 300)}`,
        suggestion: correction && correction !== excerpt ? correction.slice(0, 400) : null,
        offset: span.offset,
        length: span.length,
        excerpt: payload.slice(span.offset, span.offset + span.length),
        context: "",
      });
    }

    return { model, issues, truncated };
  } catch (err) {
    console.error("LLM grammar review failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merges model findings into rule findings, dropping any that overlap a span
 * the rules already flagged. The rules are exact and carry a mechanical fix,
 * so they win ties.
 */
export function mergeIssues(
  ruleIssues: GrammarIssue[],
  llmIssues: GrammarIssue[],
): GrammarIssue[] {
  const overlaps = (a: GrammarIssue, b: GrammarIssue) =>
    a.offset < b.offset + b.length && b.offset < a.offset + a.length;

  const merged = [...ruleIssues];
  for (const cand of llmIssues) {
    if (merged.some((existing) => overlaps(existing, cand))) continue;
    merged.push(cand);
  }
  return merged.sort((a, b) => a.offset - b.offset);
}
