import { matchType } from "./similarity";
import { splitSentences } from "./text";
import type { ScanResult, SentenceMatch, SourceSummary } from "./types";

type WinstonSource = {
  score?: number;
  url?: string;
  title?: string;
  description?: string;
  plagiarismWords?: number;
  plagiarismFound?: { startIndex?: number; endIndex?: number; sequence?: string }[];
};

type WinstonResponse = {
  result?: {
    score?: number;
    sourceCounts?: number;
    textWordCounts?: number;
    totalPlagiarismWords?: number;
  };
  sources?: WinstonSource[];
  indexes?: { startIndex?: number; endIndex?: number; sequence?: string }[];
  error?: string;
  description?: string;
  credits_used?: number;
  credits_remaining?: number;
};

export type WinstonScan = {
  plagiarizedPercent: number;
  sources: SourceSummary[];
  matches: SentenceMatch[];
  creditsUsed?: number;
  creditsRemaining?: number;
  warning?: string;
};

export async function scanWinston(text: string, apiKey: string): Promise<WinstonScan | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch("https://api.gowinston.ai/v2/plagiarism", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language: "auto",
        country: "us",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as WinstonResponse;

    if (!res.ok) {
      const desc = data.description || data.error || `Winston HTTP ${res.status}`;
      return {
        plagiarizedPercent: 0,
        sources: [],
        matches: [],
        warning: `Winston API: ${desc}`,
      };
    }

    const rawScore = data.result?.score ?? 0;
    const plagiarizedPercent = asPercent(rawScore);
    const sentences = splitSentences(text);
    const sources: SourceSummary[] = (data.sources ?? [])
      .filter((s) => s.url)
      .map((s) => ({
        title: s.title || s.url || "Winston source",
        url: s.url as string,
        provider: "Winston",
        similarity: clamp01(asPercent(s.score ?? plagiarizedPercent) / 100),
        matchedSentences: s.plagiarismFound?.length || 1,
      }));

    const ranges = [
      ...(data.indexes ?? []),
      ...(data.sources ?? []).flatMap((s) => s.plagiarismFound ?? []),
    ];
    const matches: SentenceMatch[] = [];
    sentences.forEach((sentence, si) => {
      const start = text.indexOf(sentence);
      const end = start >= 0 ? start + sentence.length : -1;
      const hit = ranges.find((r) => {
        if (r.sequence && sentence.includes(r.sequence)) return true;
        if (start < 0 || r.startIndex == null || r.endIndex == null) return false;
        return r.startIndex < end && r.endIndex > start;
      });
      const src = (data.sources ?? []).find((s) =>
        (s.plagiarismFound ?? []).some(
          (p) => p.sequence && sentence.includes(p.sequence),
        ),
      );
      if (!hit && !src) return;
      const sim = clamp01(asPercent(src?.score ?? plagiarizedPercent) / 100);
      const kind = matchType(Math.max(sim, 0.34));
      if (kind === "none") return;
      matches.push({
        sentenceIndex: si,
        sentence,
        similarity: sim,
        matchType: kind,
        sourceTitle: src?.title || "Winston match",
        sourceUrl: src?.url || sources[0]?.url || "",
        sourceSnippet: (src?.description || hit?.sequence || sentence).slice(0, 280),
        provider: "Winston",
        sharedRun: 0,
      });
    });

    return {
      plagiarizedPercent,
      sources,
      matches,
      creditsUsed: data.credits_used,
      creditsRemaining: data.credits_remaining,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Winston request failed";
    return {
      plagiarizedPercent: 0,
      sources: [],
      matches: [],
      warning: `Winston API: ${message}`,
    };
  } finally {
    clearTimeout(t);
  }
}

export function mergeWinston(base: ScanResult, extra: WinstonScan): ScanResult {
  const plagiarizedPercent = Math.max(base.plagiarizedPercent, extra.plagiarizedPercent);
  const originality = Math.max(0, Math.min(100, Math.round((100 - plagiarizedPercent) * 10) / 10));
  const sourceMap = new Map<string, SourceSummary>();
  for (const s of [...base.sources, ...extra.sources]) {
    const prev = sourceMap.get(s.url);
    if (!prev || s.similarity > prev.similarity) sourceMap.set(s.url, s);
    else if (prev) prev.matchedSentences += s.matchedSentences;
  }
  const matchMap = new Map<number, SentenceMatch>();
  for (const m of [...base.matches, ...extra.matches]) {
    const prev = matchMap.get(m.sentenceIndex);
    if (!prev || m.similarity > prev.similarity) matchMap.set(m.sentenceIndex, m);
  }
  const matches = [...matchMap.values()].sort((a, b) => b.similarity - a.similarity);
  const highlights = base.highlights.map((h, i) => {
    const m = matchMap.get(i);
    if (!m) return h;
    return {
      text: h.text,
      flagged: true,
      similarity: m.similarity,
      matchType: m.matchType,
    };
  });
  const warnings = [...base.warnings];
  if (extra.warning) warnings.push(extra.warning);
  else {
    warnings.push(
      `Winston plagiarism scan applied (${extra.plagiarizedPercent}% overlap` +
        (extra.creditsUsed != null ? `; ${extra.creditsUsed} credits used` : "") +
        (extra.creditsRemaining != null ? `, ${extra.creditsRemaining} remaining` : "") +
        ").",
    );
  }
  return {
    ...base,
    originality,
    plagiarizedPercent,
    sourcesChecked: base.sourcesChecked + extra.sources.length,
    matches: matches.slice(0, 40),
    sources: [...sourceMap.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 12),
    highlights,
    warnings,
  };
}

function asPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const p = n <= 1 && n >= 0 ? n * 100 : n;
  return Math.round(Math.max(0, Math.min(100, p)) * 10) / 10;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
