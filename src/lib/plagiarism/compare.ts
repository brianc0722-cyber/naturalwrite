import { compareTexts, matchType } from "./similarity";
import { ngrams, splitSentences, tokenizeWords, wordCount } from "./text";
import type { CompareResult, HighlightSpan } from "./types";

export function compareDocuments(a: string, b: string): CompareResult {
  const breakdown = compareTexts(a, b);
  const kind = matchType(breakdown.score);
  const wa = tokenizeWords(a);
  const wb = tokenizeWords(b);
  const setB = new Set(ngrams(wb, 5));
  const sharedPhrases = ngrams(wa, 5).filter((g) => setB.has(g));
  const unique = [...new Set(sharedPhrases)].slice(0, 12);

  const highlightsA = highlightAgainst(a, b);
  const highlightsB = highlightAgainst(b, a);

  return {
    similarity: Math.round(breakdown.score * 1000) / 10,
    matchType: kind,
    wordCountA: wordCount(a),
    wordCountB: wordCount(b),
    sharedPhrases: unique,
    breakdown: {
      wordJaccard: round4(breakdown.wordJaccard),
      shingle: round4(breakdown.shingle),
      charDice: round4(breakdown.charDice),
      cosine: round4(breakdown.cosine),
      containment: round4(breakdown.containment),
    },
    highlightsA,
    highlightsB,
  };
}

function highlightAgainst(text: string, other: string): HighlightSpan[] {
  const otherShingles = new Set(ngrams(tokenizeWords(other), 4));
  return splitSentences(text).map((sentence) => {
    const grams = ngrams(tokenizeWords(sentence), 4);
    if (!grams.length) {
      return { text: sentence, flagged: false, similarity: 0, matchType: "clean" as const };
    }
    let hits = 0;
    for (const g of grams) if (otherShingles.has(g)) hits++;
    const sim = hits / grams.length;
    const flagged = sim >= 0.35;
    const matchType = sim >= 0.72 ? "exact" : sim >= 0.48 ? "near" : sim >= 0.35 ? "paraphrase" : "clean";
    return { text: sentence, flagged, similarity: sim, matchType };
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
