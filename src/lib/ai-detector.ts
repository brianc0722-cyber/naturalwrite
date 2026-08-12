import type { ScanSignal, ScanStyleMatch, StyleProfile } from "@/db/schema";
import { formalityOf } from "@/lib/style-analyzer";
import { SCORE_HIGH, SCORE_LOW } from "@/lib/score-bands";
import { wordsOf } from "@/lib/tokenize";

/**
 * Shown alongside every result. This detector measures stylistic markers
 * that correlate with LLM output — it cannot establish authorship. Formal
 * human writing (academic, legal, corporate) scores high; lightly edited
 * AI scores low. It must never be used as evidence of misconduct.
 */
export const DETECTOR_DISCLAIMER =
  "This is a stylistic signal, not proof of authorship. Formal human writing often scores high and edited AI often scores low. Do not use this score to accuse anyone.";

export type AiDetection = {
  score: number; // 0 = human, 100 = AI
  verdict: string;
  confidence: "low" | "medium" | "high";
  wordCount: number;
  signals: ScanSignal[];
  styleMatch: ScanStyleMatch;
};

/**
 * Stock LLM phrasing, split by evidential strength.
 *
 * STRONG: distinctive multi-word constructions that rarely appear in
 * unassisted prose. These carry full weight.
 *
 * WEAK: formal register words that LLMs overuse but that also occur
 * naturally in academic, legal and corporate human writing. Counting
 * these at full weight was the main driver of false positives on formal
 * human prose, so they are worth a fraction of a strong hit.
 *
 * Discourse connectives (furthermore / moreover / consequently /
 * in conclusion / additionally) are deliberately NOT listed here — they
 * are already scored by the "Formulaic transitions" signal below, and
 * listing them in both places double-penalised the same evidence.
 */
const AI_PHRASES_STRONG = [
  "delve into",
  "rich tapestry",
  "underscores the importance",
  "in today's fast-paced",
  "in today's digital",
  "ever-evolving",
  "ever-changing",
  "it is important to note",
  "it's important to note",
  "it is worth noting",
  "it's worth noting",
  "a testament to",
  "plays a crucial role",
  "play a crucial role",
  "in the realm of",
  "at the end of the day",
  "a myriad of",
  "shed light on",
  "sheds light on",
  "paves the way",
  "paving the way",
  "navigate the complexities",
  "navigate the landscape",
  "holistic approach",
  "nuanced understanding",
  "seamless integration",
  "game-changer",
  "game changer",
  "elevate your",
  "embark on a journey",
  "embark on this",
  "beacon of",
  "comprehensive understanding",
  "harness the power",
  "harnessing the power",
  "at the forefront",
  "paramount importance",
  "of paramount",
  "revolutionize",
  "revolutionizes",
  "unlock the",
  "unlocks the",
  "the landscape of",
];

const AI_PHRASES_WEAK = [
  "dive into",
  "tapestry",
  "underscore",
  "crucial role",
  "pivotal role",
  "in the world of",
  "when it comes to",
  "a wide range of",
  "various aspects",
  "serves as a",
  "serve as a",
  "foster a",
  "fosters a",
  "leverage the",
  "leverages the",
  "multifaceted",
  "cutting-edge",
  "state-of-the-art",
  "elevates",
  "interplay between",
  "intricate",
  "meticulous",
  "robust",
  "transformative",
  "ultimately",
  "the future of",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary matchers for AI_PHRASES.
 *
 * Naive substring matching (`text.includes("robust")`) fires on ordinary
 * words like "robustness", "meticulously", "elevated", "intricately" and
 * "underscored", which produced false AI accusations on human prose.
 * Each phrase is anchored with \b so only whole words/phrases count.
 *
 * Built once at module load — building these per call would be wasteful.
 */
type PhraseMatcher = { phrase: string; re: RegExp; weight: number };

/**
 * Word-boundary matchers for the phrase lists.
 *
 * Naive substring matching (`text.includes("robust")`) fired on ordinary
 * words like "robustness", "meticulously", "elevated", "intricately" and
 * "underscored", which produced false AI accusations on human prose.
 * Each phrase is anchored with \b so only whole words/phrases count.
 *
 * Built once at module load — rebuilding per call would be wasteful.
 */
const AI_PHRASE_MATCHERS: PhraseMatcher[] = [
  ...AI_PHRASES_STRONG.map((phrase) => ({
    phrase,
    re: new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i"),
    weight: 1,
  })),
  ...AI_PHRASES_WEAK.map((phrase) => ({
    phrase,
    re: new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i"),
    weight: 0.4,
  })),
];

/**
 * Drops phrases fully contained in a longer phrase that also matched, so
 * "plays a crucial role" isn't additionally counted as "crucial role".
 */
function dedupeContainedPhrases(hits: PhraseMatcher[]): PhraseMatcher[] {
  const byLength = [...hits].sort((a, b) => b.phrase.length - a.phrase.length);
  const kept: PhraseMatcher[] = [];
  for (const hit of byLength) {
    if (!kept.some((k) => k.phrase.includes(hit.phrase))) kept.push(hit);
  }
  return kept;
}

/**
 * Minimum word count used as the denominator for per-1,000-word rates.
 * Without a floor, one hit in a short excerpt extrapolates to a huge rate
 * and saturates the signal on very little evidence.
 */
const RATE_BASIS = 250;

/**
 * Evidence floor before the scanner will comment on how well a text
 * matches the user's learned style.
 */
const MIN_PROFILE_SAMPLES = 3;
const MIN_PROFILE_WORDS = 1000;

const DISCOURSE_OPENERS =
  /^(furthermore|moreover|additionally|consequently|therefore|thus|hence|however|in conclusion|in summary|in addition|as a result|on the other hand|it is worth noting|it's worth noting|notably|importantly)\b/i;

const HEDGES =
  /\b(it can be argued|it could be argued|it may be|it might be|it is possible|potentially|arguably|to some extent|in many ways|can be seen as|is often considered|tends to|generally speaking|broadly speaking)\b/gi;

const PARALLEL =
  /\b(not only\b[\s\S]{0,80}?\bbut also|whether it's|whether it is|it is not just\b[\s\S]{0,80}?\bit is (also|about)|from\b[\s\S]{0,40}?\bto\b[\s\S]{0,40}?\bto\b)/gi;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return (text.match(new RegExp(re.source, flags)) ?? []).length;
}

function coefficientOfVariation(nums: number[]): number {
  if (nums.length < 2) return 1;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (mean === 0) return 1;
  const variance =
    nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance) / mean;
}

function push(
  signals: ScanSignal[],
  label: string,
  points: number,
  detail: string,
) {
  if (points !== 0) signals.push({ label, points, detail });
}

export function detectAi(
  input: string,
  profile: StyleProfile | null,
): AiDetection {
  const text = input.trim();
  const words = wordsOf(text);
  const sentences = sentencesOf(text);
  const paragraphs = paragraphsOf(text);
  const wordCount = words.length;
  const per1k = 1000 / Math.max(wordCount, 1);

  const signals: ScanSignal[] = [];
  let score = 18; // mild neutral prior

  // 1. AI-favorite phrases (whole-word matches only — see AI_PHRASE_MATCHERS)
  const phraseMatches = dedupeContainedPhrases(
    AI_PHRASE_MATCHERS.filter(({ re }) => re.test(text)),
  );
  const phraseHits = phraseMatches.map((m) => m.phrase);
  const weightedHits = phraseMatches.reduce((sum, m) => sum + m.weight, 0);
  // Normalise against a floor, not the raw word count: with a plain per-1k
  // rate a single hit in a 100-word excerpt extrapolated to "10 per 1,000
  // words" and maxed out the signal. Short texts now need real density.
  const phraseRate = (weightedHits * 1000) / Math.max(wordCount, RATE_BASIS);
  const phrasePoints = Math.min(24, Math.round(phraseRate * 4));
  push(
    signals,
    "AI-favorite phrases",
    phrasePoints,
    phraseHits.length
      ? `Found ${phraseHits.length} stock AI phrase${phraseHits.length === 1 ? "" : "s"}: ${phraseHits.slice(0, 4).map((p) => `“${p}”`).join(", ")}${phraseHits.length > 4 ? "…" : ""}`
      : "No stock AI phrases detected",
  );
  score += phrasePoints;

  // 2. Burstiness — AI sentences are uniform in length
  const sentLens = sentences.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const cv = coefficientOfVariation(sentLens);
  if (cv < 0.32) {
    score += 18;
    push(
      signals,
      "Uniform sentence rhythm",
      18,
      `Sentence lengths are unusually even (variation ${Math.round(cv * 100)}%) — AI text rarely speeds up or slows down`,
    );
  } else if (cv < 0.45) {
    score += 9;
    push(
      signals,
      "Somewhat uniform rhythm",
      9,
      `Sentence lengths vary less than typical human writing (${Math.round(cv * 100)}%)`,
    );
  } else if (cv > 0.7) {
    score -= 8;
    push(
      signals,
      "Natural rhythm variation",
      -8,
      "Mixes short punchy and long flowing sentences — a human fingerprint",
    );
  }

  // 3. Discourse-marker openers
  const openerHits = sentences.filter((s) => DISCOURSE_OPENERS.test(s)).length;
  const openerRate = (openerHits / Math.max(sentences.length, 1)) * 100;
  const openerPoints = Math.min(14, Math.round(openerRate * 0.8));
  push(
    signals,
    "Formulaic transitions",
    openerPoints,
    openerHits
      ? `${openerRate.toFixed(0)}% of sentences open with connectors like “Furthermore” / “Moreover” / “In conclusion”`
      : "No formulaic transition openers",
  );
  score += openerPoints;

  // 4. Hedging
  const hedgeHits = countMatches(text, HEDGES);
  const hedgeRate = hedgeHits * per1k;
  const hedgePoints = Math.min(10, Math.round(hedgeRate * 4));
  push(
    signals,
    "Hedging language",
    hedgePoints,
    hedgeHits
      ? `Frequent hedges like “it can be argued” / “potentially” (${hedgeHits} found)`
      : "Little hedging language",
  );
  score += hedgePoints;

  // 5. Contractions + first person (AI avoids both)
  const contractions = countMatches(
    text,
    /\b(I'm|you're|we're|they're|it's|that's|don't|doesn't|didn't|won't|can't|isn't|aren't|wasn't|weren't|I've|you've|we've|I'll|you'll|we'll|I'd|you'd|we'd)\b/gi,
  );
  const contractionRate = contractions * per1k;
  if (contractionRate < 4) {
    score += 8;
    push(
      signals,
      "No contractions",
      8,
      "Almost no contractions — AI defaults to fully spelled-out forms",
    );
  } else if (contractionRate > 12) {
    score -= 6;
    push(
      signals,
      "Contractions present",
      -6,
      "Uses contractions naturally, like most human writing",
    );
  }

  const firstPerson = countMatches(
    text,
    /\b(I|me|my|mine|myself|we|us|our|ours)\b/gi,
  );
  const fpRate = firstPerson * per1k;
  if (fpRate < 3 && wordCount > 60) {
    score += 6;
    push(
      signals,
      "No personal voice",
      6,
      "Almost no first-person presence — reads detached, like AI output",
    );
  } else if (fpRate > 15) {
    score -= 5;
    push(
      signals,
      "Personal voice",
      -5,
      "Strong first-person presence typical of original writing",
    );
  }

  // 6. Parallel/template structures
  const parallelHits = countMatches(text, PARALLEL);
  const parallelPoints = Math.min(8, parallelHits * 3);
  push(
    signals,
    "Template structures",
    parallelPoints,
    parallelHits
      ? `Found ${parallelHits} template pattern${parallelHits === 1 ? "" : "s"} like “not only… but also”`
      : "No template parallel structures",
  );
  score += parallelPoints;

  // 7. Uniform paragraph length
  if (paragraphs.length >= 3) {
    const pLens = paragraphs.map((p) => wordsOf(p).length);
    const pcv = coefficientOfVariation(pLens);
    if (pcv < 0.25) {
      score += 8;
      push(
        signals,
        "Uniform paragraphs",
        8,
        "Paragraphs are nearly identical in length — a template signature",
      );
    }
  }

  // 8. Concreteness — humans include numbers, names, specifics
  const digits = (text.match(/\d+/g) ?? []).length;
  const digitRate = digits * per1k;
  if (digitRate < 2 && wordCount > 80) {
    score += 4;
    push(
      signals,
      "Low concreteness",
      4,
      "Few numbers or specifics — AI writing tends to stay abstract",
    );
  } else if (digitRate > 8) {
    score -= 4;
    push(
      signals,
      "Concrete details",
      -4,
      "Includes numbers and specifics typical of original reporting/writing",
    );
  }

  // 9. Cross-check with the user's learned style
  let styleMatch: ScanStyleMatch = null;
  // Require real evidence before claiming a style match. Previously one
  // 63-word sample produced "Strongly matches your learned writing style
  // (76%)" on unrelated text — high-confidence wording from no evidence.
  if (
    profile &&
    profile.sampleCount >= MIN_PROFILE_SAMPLES &&
    profile.sampleWordCount >= MIN_PROFILE_WORDS
  ) {
    const sents =
      wordCount / Math.max(sentences.length, 1);
    const sentDiff = Math.abs(sents - profile.avgSentenceLength) /
      Math.max(profile.avgSentenceLength, 1);
    // Measure the scanned text on the same 0-1 scale the profile was built
    // with. The previous code substituted a coarse bucket derived from
    // contraction rate (0.25 / 0.5 / 0.8), so this term partly measured the
    // bucket boundaries rather than an actual difference in formality.
    const formDiff = Math.abs(
      formalityOf(text, sentences.length) - profile.formalityScore,
    );
    // Both sides must be in the same unit. `fpRate` is occurrences per
    // 1,000 words; `profile.firstPersonRate` is a 0-1 fraction. The old
    // code multiplied the fraction by 10, which is not a conversion — the
    // two terms only agreed by coincidence on first-person-heavy text.
    const profileFpPer1k = profile.firstPersonRate * 1000;
    const fpDiff = Math.abs(
      Math.min(fpRate, 30) / 30 - Math.min(profileFpPer1k, 30) / 30,
    );
    const match = Math.max(
      0,
      1 - (sentDiff * 0.4 + formDiff * 0.35 + fpDiff * 0.25),
    );
    const percent = Math.round(match * 100);
    if (match > 0.72) {
      score -= 16;
      styleMatch = {
        percent,
        note: `Strongly matches your learned writing style (${percent}%) — reads like your own work.`,
      };
      push(
        signals,
        "Matches your style",
        -16,
        `Rhythm, register, and voice closely match the ${profile.sampleCount} sample${profile.sampleCount === 1 ? "" : "s"} you uploaded`,
      );
    } else if (match < 0.35) {
      score += 10;
      styleMatch = {
        percent,
        note: `Doesn't match your learned style (${percent}%) — the voice here is different from your samples.`,
      };
      push(
        signals,
        "Unlike your style",
        10,
        "Register and rhythm differ sharply from your uploaded samples",
      );
    } else {
      styleMatch = {
        percent,
        note: `Partially matches your learned style (${percent}%).`,
      };
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const confidence: AiDetection["confidence"] =
    wordCount < 40 ? "low" : wordCount < 150 ? "medium" : "high";

  // Deliberately non-determinative wording. This is a stylistic heuristic,
  // not provenance evidence: formal human prose scores high and lightly
  // edited AI scores low. See DISCLAIMER below, surfaced in the UI.
  const verdict =
    score < SCORE_LOW
      ? "Few AI-style patterns"
      : score < SCORE_HIGH
        ? "Some AI-style patterns"
        : "Many AI-style patterns";

  signals.sort((a, b) => b.points - a.points);

  return { score, verdict, confidence, wordCount, signals, styleMatch };
}
