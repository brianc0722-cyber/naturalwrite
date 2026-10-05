export type MatchType = "exact" | "near" | "paraphrase" | "none";

export type SourceHit = {
  title: string;
  url: string;
  snippet: string;
  provider: string;
};

export type SentenceMatch = {
  sentenceIndex: number;
  sentence: string;
  similarity: number;
  matchType: MatchType;
  sourceTitle: string;
  sourceUrl: string;
  sourceSnippet: string;
  provider: string;
  sharedRun: number;
};

export type SourceSummary = {
  title: string;
  url: string;
  provider: string;
  similarity: number;
  matchedSentences: number;
};

export type HighlightSpan = {
  text: string;
  flagged: boolean;
  similarity: number;
  matchType: MatchType | "clean";
};

export type ScanResult = {
  originality: number;
  plagiarizedPercent: number;
  wordCount: number;
  sentenceCount: number;
  queriesRun: number;
  sourcesChecked: number;
  matches: SentenceMatch[];
  sources: SourceSummary[];
  highlights: HighlightSpan[];
  warnings: string[];
  elapsedMs: number;
};

export type CompareResult = {
  similarity: number;
  matchType: MatchType | "none";
  wordCountA: number;
  wordCountB: number;
  sharedPhrases: string[];
  breakdown: {
    wordJaccard: number;
    shingle: number;
    charDice: number;
    cosine: number;
    containment: number;
  };
  highlightsA: HighlightSpan[];
  highlightsB: HighlightSpan[];
};
