import { searchAllSources } from "./sources";
import { compareTexts, longestCommonWordRun, matchType } from "./similarity";
import {
  exactPhraseQueries,
  gramContainment,
  splitSentences,
  tokenizeWords,
  wordCount,
} from "./text";
import type { HighlightSpan, ScanResult, SentenceMatch, SourceSummary } from "./types";
import { fetchPageText, searchWeb } from "./web";
import type { SourceHit } from "./types";
import { mergeWinston, scanWinston } from "./winston";

const SENTENCE_FLAG = 0.28;

export async function scanText(
  text: string,
  keys?: { serpKey?: string; braveKey?: string; winstonKey?: string },
): Promise<ScanResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const sentences = splitSentences(text);
  const wc = wordCount(text);

  if (wc < 20) warnings.push("Enter at least 20 words for a reliable scan.");

  const winstonPromise =
    keys?.winstonKey && wc >= 16
      ? scanWinston(text, keys.winstonKey)
      : Promise.resolve(null);
  if (keys?.winstonKey && wc < 16) {
    warnings.push("Winston needs at least 16 words; skipped.");
  }

  const phrases = exactPhraseQueries(text, 5);
  const hits: SourceHit[] = [];
  const seenUrl = new Set<string>();

  const addHits = (list: SourceHit[]) => {
    for (const h of list) {
      const key = h.url.replace(/\/$/, "").toLowerCase();
      if (!key || seenUrl.has(key)) continue;
      seenUrl.add(key);
      hits.push(h);
    }
  };

  for (let i = 0; i < phrases.length; i += 2) {
    const batch = phrases.slice(i, i + 2);
    const web = await Promise.all(batch.map((q) => searchWeb(q, keys)));
    web.forEach(addHits);

    const academic = await Promise.all(
      batch.slice(0, 1).map((q) => searchAllSources(q, keys?.serpKey)),
    );
    academic.forEach(addHits);
  }

  if (!phrases.length && wc >= 20) {
    warnings.push("Could not extract distinctive phrases. Try a longer excerpt.");
  }

  const pages: { hit: SourceHit; body: string }[] = [];
  const toFetch = hits.slice(0, 8);
  for (let i = 0; i < toFetch.length; i += 3) {
    const batch = toFetch.slice(i, i + 3);
    const bodies = await Promise.all(
      batch.map(async (hit) => {
        const snippetBody = `${hit.title}. ${hit.snippet}`;
        const page = await fetchPageText(hit.url);
        const body = page.length > snippetBody.length ? page : snippetBody;
        return { hit, body };
      }),
    );
    pages.push(...bodies);
  }

  const matches: SentenceMatch[] = [];

  for (let si = 0; si < sentences.length; si++) {
    const sentence = sentences[si];
    const sw = tokenizeWords(sentence);
    if (sw.length < 5) continue;

    let best: SentenceMatch | null = null;
    for (const page of pages) {
      const sim = compareTexts(sentence, page.body);
      const run = longestCommonWordRun(sentence, page.body);
      const contain = gramContainment(sentence, page.body, 4);
      let score = Math.max(sim.score, contain);
      if (run >= 10) score = Math.max(score, 0.92);
      else if (run >= 8) score = Math.max(score, 0.78);
      else if (run >= 6) score = Math.max(score, 0.55);
      const kind = matchType(score);
      if (kind === "none") continue;
      if (!best || score > best.similarity) {
        best = {
          sentenceIndex: si,
          sentence,
          similarity: score,
          matchType: kind,
          sourceTitle: page.hit.title,
          sourceUrl: page.hit.url,
          sourceSnippet: page.body.slice(0, 280),
          provider: page.hit.provider,
          sharedRun: run,
        };
      }
    }
    if (best && best.similarity >= SENTENCE_FLAG) matches.push(best);
  }

  matches.sort((a, b) => b.similarity - a.similarity);

  let bestPageContain = 0;
  let bestPage: (typeof pages)[number] | null = null;
  for (const page of pages) {
    if (page.body.length < 80) continue;
    const c = gramContainment(text, page.body, 5);
    if (c > bestPageContain) {
      bestPageContain = c;
      bestPage = page;
    }
  }

  const flaggedIndexes = new Set(matches.map((m) => m.sentenceIndex));
  let matchedWordCount = 0;
  sentences.forEach((s, index) => {
    if (flaggedIndexes.has(index)) matchedWordCount += tokenizeWords(s).length;
  });

  const sentenceOverlap = wc === 0 ? 0 : matchedWordCount / wc;
  const plagiarizedPercent =
    Math.round(Math.max(sentenceOverlap, bestPageContain) * 1000) / 10;
  const originality = Math.max(0, Math.min(100, Math.round((100 - plagiarizedPercent) * 10) / 10));

  if (bestPage && bestPageContain >= 0.25) {
    const already = matches.some((m) => m.sourceUrl === bestPage!.hit.url);
    if (!already) {
      matches.unshift({
        sentenceIndex: 0,
        sentence: sentences[0] || "",
        similarity: bestPageContain,
        matchType: matchType(Math.max(bestPageContain, 0.4)),
        sourceTitle: bestPage.hit.title,
        sourceUrl: bestPage.hit.url,
        sourceSnippet: bestPage.body.slice(0, 280),
        provider: bestPage.hit.provider,
        sharedRun: 0,
      });
    }
  }

  const sourceMap = new Map<string, SourceSummary>();
  for (const m of matches) {
    const prev = sourceMap.get(m.sourceUrl);
    if (!prev) {
      sourceMap.set(m.sourceUrl, {
        title: m.sourceTitle,
        url: m.sourceUrl,
        provider: m.provider,
        similarity: m.similarity,
        matchedSentences: 1,
      });
    } else {
      prev.matchedSentences += 1;
      prev.similarity = Math.max(prev.similarity, m.similarity);
    }
  }
  if (bestPage) {
    const prev = sourceMap.get(bestPage.hit.url);
    const sim = Math.max(bestPageContain, prev?.similarity ?? 0);
    sourceMap.set(bestPage.hit.url, {
      title: bestPage.hit.title,
      url: bestPage.hit.url,
      provider: bestPage.hit.provider,
      similarity: sim,
      matchedSentences: prev?.matchedSentences ?? 1,
    });
  }

  const highlights: HighlightSpan[] = sentences.map((sentence, i) => {
    const m = matches.find((x) => x.sentenceIndex === i);
    if (!m) return { text: sentence, flagged: false, similarity: 0, matchType: "clean" };
    return {
      text: sentence,
      flagged: true,
      similarity: m.similarity,
      matchType: m.matchType,
    };
  });

  const webHits = hits.filter((h) => h.provider === "Web" || h.provider === "Brave" || h.provider === "Google");
  if (wc >= 20 && webHits.length === 0) {
    warnings.push(
      "Web search found no pages for your exact phrases. News/blog copies are often missed unless a web result is returned. Try a longer unique sentence, or add BRAVE_API_KEY / SERPAPI_KEY.",
    );
  }
  if (wc >= 20 && hits.length === 0) {
    warnings.push("No sources responded. Check your internet connection.");
  }
  if (bestPageContain >= 0.4) {
    warnings.push(
      `Strong overlap with “${bestPage?.hit.title ?? "a web page"}” (${Math.round(bestPageContain * 100)}% of 5-word phrases also appear there).`,
    );
  }

  let result: ScanResult = {
    originality,
    plagiarizedPercent,
    wordCount: wc,
    sentenceCount: sentences.length,
    queriesRun: phrases.length,
    sourcesChecked: hits.length,
    matches: matches.slice(0, 40),
    sources: [...sourceMap.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 12),
    highlights,
    warnings,
    elapsedMs: Date.now() - started,
  };

  const winston = await winstonPromise;
  if (winston) result = mergeWinston(result, winston);
  result.elapsedMs = Date.now() - started;
  return result;
}
