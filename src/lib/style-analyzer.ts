import type { StyleProfile } from "@/db/schema";

const CONTRACTIONS =
  /\b(I'm|I've|I'd|I'll|you're|you've|you'd|you'll|we're|we've|we'd|we'll|they're|they've|they'd|they'll|it's|that's|there's|here's|who's|what's|where's|when's|why's|how's|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|doesn't|don't|didn't|won't|wouldn't|shouldn't|couldn't|can't|mustn't|needn't|ain't|y'all|gonna|wanna|gotta)\b/gi;

const FIRST_PERSON =
  /\b(I|me|my|mine|myself|we|us|our|ours|ourselves)\b/gi;

/** Shared thresholds so profile notes, UI, and rewrite stay consistent. */
export const CONTRACTION_FREQUENT = 0.015;
export const CONTRACTION_RARE = 0.008;

export function contractionLabel(
  rate: number,
): "Frequent" | "Some" | "Rare" {
  if (rate >= CONTRACTION_FREQUENT) return "Frequent";
  if (rate < CONTRACTION_RARE) return "Rare";
  return "Some";
}

export function contractionToneNote(rate: number): string {
  if (rate >= CONTRACTION_FREQUENT) return "natural use of contractions";
  if (rate < CONTRACTION_RARE) return "often writes without contractions";
  return "uses contractions selectively";
}
const PASSIVE_HINT =
  /\b(am|is|are|was|were|be|been|being)\s+\w+(ed|en)\b/gi;

const FORMAL_MARKERS =
  /\b(therefore|thus|hence|moreover|furthermore|consequently|nevertheless|wherein|whereby|heretofore|aforementioned|pursuant|regarding|with respect to|in accordance with)\b/gi;

const INFORMAL_MARKERS =
  /\b(yeah|yep|nope|kinda|sorta|gonna|wanna|gotta|lol|haha|btw|tbh|imo|like,|you know|honestly|basically|literally|super|pretty much|a bunch|stuff|things)\b/gi;

const TRANSITIONS = [
  "however",
  "therefore",
  "meanwhile",
  "in contrast",
  "for example",
  "in other words",
  "as a result",
  "on the other hand",
  "that said",
  "in fact",
  "of course",
  "at the same time",
  "for instance",
  "in addition",
  "beyond that",
  "still",
  "even so",
  "after all",
];

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const copy = new RegExp(re.source, flags);
  return (text.match(copy) ?? []).length;
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function topFrequent(items: string[], limit: number, minCount = 2): string[] {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return [...map.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

export function analyzeTexts(samples: string[]): StyleProfile {
  // Count only samples with real content. `samples.length` was used below,
  // which meant a batch of blank strings reported sampleCount > 0 and made
  // callers believe a usable style profile existed (style-analyzer.ts:575,
  // api/scan/route.ts hasProfile).
  const nonEmpty = samples.filter((s) => s.trim().length > 0);
  const combined = nonEmpty.join("\n\n");
  const words = wordsOf(combined);
  const sentences = sentencesOf(combined);
  const wordCount = words.length || 1;
  const sentenceCount = sentences.length || 1;

  const avgSentenceLength = wordCount / sentenceCount;
  const avgWordLength =
    words.reduce((sum, w) => sum + w.replace(/'/g, "").length, 0) / wordCount;

  const unique = new Set(words);
  const vocabularyRichness = unique.size / wordCount;

  const contractionRate = countMatches(combined, CONTRACTIONS) / wordCount;
  const questionRate =
    countMatches(combined, /\?/g) / Math.max(sentenceCount, 1);
  const exclamationRate =
    countMatches(combined, /!/g) / Math.max(sentenceCount, 1);
  const commaDensity = countMatches(combined, /,/g) / wordCount;
  const semicolonDensity = countMatches(combined, /;/g) / wordCount;
  const emDashDensity = countMatches(combined, /—|--/g) / wordCount;
  const firstPersonRate = countMatches(combined, FIRST_PERSON) / wordCount;
  const passiveVoiceHint = countMatches(combined, PASSIVE_HINT) / sentenceCount;

  const formalHits = countMatches(combined, FORMAL_MARKERS);
  const informalHits = countMatches(combined, INFORMAL_MARKERS);
  const formalityRaw =
    (formalHits - informalHits * 1.4) / Math.max(sentenceCount, 1);
  const formalityScore = Math.min(1, Math.max(0, 0.5 + formalityRaw * 0.35));

  const lower = combined.toLowerCase();
  const commonTransitions = TRANSITIONS.filter((t) => lower.includes(t)).slice(
    0,
    8,
  );

  const bigrams = ngrams(words, 2);
  const trigrams = ngrams(words, 3);
  const signaturePhrases = [
    ...topFrequent(trigrams, 4, 2),
    ...topFrequent(bigrams, 6, 3),
  ].slice(0, 8);

  const preferredOpeners = topFrequent(
    sentences
      .map((s) => {
        const toks = wordsOf(s).slice(0, 3);
        return toks.join(" ");
      })
      .filter((s) => s.length > 2),
    5,
    1,
  );

  const toneNotes: string[] = [];
  if (avgSentenceLength < 12) toneNotes.push("prefers short, punchy sentences");
  else if (avgSentenceLength > 22)
    toneNotes.push("comfortable with longer, flowing sentences");
  else toneNotes.push("uses moderate sentence length");

  toneNotes.push(contractionToneNote(contractionRate));

  if (formalityScore > 0.65) toneNotes.push("leans formal and precise");
  else if (formalityScore < 0.35) toneNotes.push("leans casual and conversational");
  else toneNotes.push("balanced tone between casual and formal");

  if (firstPersonRate > 0.04) toneNotes.push("frequently writes in first person");
  if (questionRate > 0.12) toneNotes.push("asks rhetorical or direct questions");
  if (emDashDensity > 0.004) toneNotes.push("uses em dashes for asides");
  if (semicolonDensity > 0.002)
    toneNotes.push("occasionally joins related clauses with semicolons");
  if (vocabularyRichness > 0.55) toneNotes.push("varied vocabulary");
  else if (vocabularyRichness < 0.35)
    toneNotes.push("repeats familiar wording for clarity");

  return {
    avgSentenceLength: round(avgSentenceLength, 2),
    avgWordLength: round(avgWordLength, 2),
    vocabularyRichness: round(vocabularyRichness, 3),
    contractionRate: round(contractionRate, 4),
    questionRate: round(questionRate, 3),
    exclamationRate: round(exclamationRate, 3),
    commaDensity: round(commaDensity, 4),
    semicolonDensity: round(semicolonDensity, 4),
    emDashDensity: round(emDashDensity, 4),
    firstPersonRate: round(firstPersonRate, 4),
    passiveVoiceHint: round(passiveVoiceHint, 3),
    formalityScore: round(formalityScore, 3),
    commonTransitions,
    signaturePhrases,
    preferredOpeners,
    toneNotes,
    sampleWordCount: words.length,
    sampleCount: nonEmpty.length,
  };
}

export function summarizeProfile(profile: StyleProfile): string {
  const bits = [
    `Based on ${profile.sampleCount} sample${profile.sampleCount === 1 ? "" : "s"} (${profile.sampleWordCount} words).`,
    `Typical sentence ~${Math.round(profile.avgSentenceLength)} words.`,
    ...profile.toneNotes.slice(0, 4).map((n) => capitalize(n) + "."),
  ];
  if (profile.signaturePhrases.length) {
    bits.push(
      `Recurring phrases: ${profile.signaturePhrases.slice(0, 4).map((p) => `"${p}"`).join(", ")}.`,
    );
  }
  return bits.join(" ");
}

function round(n: number, places: number) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FORMAL_TO_CASUAL: Array<[RegExp, string]> = [
  [/\butilize\b/gi, "use"],
  [/\bapproximately\b/gi, "about"],
  [/\bsubsequently\b/gi, "then"],
  [/\btherefore\b/gi, "so"],
  [/\bhowever\b/gi, "but"],
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bat this point in time\b/gi, "now"],
  [/\bprior to\b/gi, "before"],
  [/\bcommence\b/gi, "start"],
  [/\bterminate\b/gi, "end"],
  [/\bassist\b/gi, "help"],
  [/\bobtain\b/gi, "get"],
  [/\bdemonstrate\b/gi, "show"],
  [/\bindividuals\b/gi, "people"],
  [/\badditional\b/gi, "more"],
  [/\bsufficient\b/gi, "enough"],
  [/\bnumerous\b/gi, "many"],
  [/\bfacilitate\b/gi, "help"],
  [/\bregarding\b/gi, "about"],
  [/\bin the event that\b/gi, "if"],
  [/\bit is important to note that\b/gi, ""],
  [/\bit should be noted that\b/gi, ""],
  [/\bin conclusion\b/gi, "overall"],
  [/\bleverage\b/gi, "use"],
  [/\bsynergy\b/gi, "teamwork"],
  [/\bparadigm\b/gi, "model"],
  [/\brobust\b/gi, "strong"],
  [/\bseamless\b/gi, "smooth"],
  [/\bcutting-edge\b/gi, "modern"],
  [/\bstate-of-the-art\b/gi, "advanced"],
];

/**
 * Casual -> formal substitutions.
 *
 * Only unambiguous, part-of-speech-stable pairs belong here. Several
 * entries were removed because a context-free global swap corrupted
 * ordinary sentences:
 *   end -> conclude        "the end result" became "the conclude result"
 *   get -> obtain          breaks "get up", "get along", "get it"
 *   things -> items        needless register shift, often wrong
 *   but -> however         ungrammatical mid-clause ("...salt, however pepper")
 *   so -> therefore        breaks "so that", "so much", "not so"
 *   literally -> ""        silently deletes a word the author chose
 *   show -> demonstrate    breaks the noun sense ("a TV show")
 *   help -> assist         breaks "can't help it"
 *   about -> regarding     breaks "about to", "walked about"
 */
const CASUAL_TO_FORMAL: Array<[RegExp, string]> = [
  [/\ba lot of\b/gi, "many"],
  [/\bkinda\b/gi, "somewhat"],
  [/\bsorta\b/gi, "somewhat"],
  [/\bgonna\b/gi, "going to"],
  [/\bwanna\b/gi, "want to"],
  [/\bgotta\b/gi, "need to"],
  [/\byeah\b/gi, "yes"],
  [/\bnope\b/gi, "no"],
  [/\bpretty much\b/gi, "largely"],
  [/\bbasically\b/gi, "essentially"],
  [/\bsuper\b(?= (?:good|bad|nice|cool|fast|slow|hard|easy|important))/gi, "very"],
  [/\bbecause of the fact that\b/gi, "because"],
];

const CONTRACTION_EXPAND: Array<[RegExp, string]> = [
  [/\bI'm\b/g, "I am"],
  [/\bI've\b/g, "I have"],
  [/\bI'd\b/g, "I would"],
  [/\bI'll\b/g, "I will"],
  [/\byou're\b/gi, "you are"],
  [/\byou've\b/gi, "you have"],
  [/\byou'd\b/gi, "you would"],
  [/\byou'll\b/gi, "you will"],
  [/\bwe're\b/gi, "we are"],
  [/\bwe've\b/gi, "we have"],
  [/\bwe'd\b/gi, "we would"],
  [/\bwe'll\b/gi, "we will"],
  [/\bthey're\b/gi, "they are"],
  [/\bthey've\b/gi, "they have"],
  [/\bthey'd\b/gi, "they would"],
  [/\bthey'll\b/gi, "they will"],
  [/\bit's\b/gi, "it is"],
  [/\bthat's\b/gi, "that is"],
  [/\bthere's\b/gi, "there is"],
  [/\bisn't\b/gi, "is not"],
  [/\baren't\b/gi, "are not"],
  [/\bwasn't\b/gi, "was not"],
  [/\bweren't\b/gi, "were not"],
  [/\bhasn't\b/gi, "has not"],
  [/\bhaven't\b/gi, "have not"],
  [/\bhadn't\b/gi, "had not"],
  [/\bdoesn't\b/gi, "does not"],
  [/\bdon't\b/gi, "do not"],
  [/\bdidn't\b/gi, "did not"],
  [/\bwon't\b/gi, "will not"],
  [/\bwouldn't\b/gi, "would not"],
  [/\bshouldn't\b/gi, "should not"],
  [/\bcouldn't\b/gi, "could not"],
  [/\bcan't\b/gi, "cannot"],
];

const EXPAND_TO_CONTRACTION: Array<[RegExp, string]> = [
  [/\bI am\b/g, "I'm"],
  [/\bI have\b/g, "I've"],
  [/\bI would\b/g, "I'd"],
  [/\bI will\b/g, "I'll"],
  [/\byou are\b/gi, "you're"],
  [/\byou have\b/gi, "you've"],
  [/\byou will\b/gi, "you'll"],
  [/\bwe are\b/gi, "we're"],
  [/\bwe have\b/gi, "we've"],
  [/\bwe will\b/gi, "we'll"],
  [/\bthey are\b/gi, "they're"],
  [/\bthey have\b/gi, "they've"],
  [/\bthey will\b/gi, "they'll"],
  [/\bit is\b/gi, "it's"],
  [/\bthat is\b/gi, "that's"],
  [/\bthere is\b/gi, "there's"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bwas not\b/gi, "wasn't"],
  [/\bwere not\b/gi, "weren't"],
  [/\bhas not\b/gi, "hasn't"],
  [/\bhave not\b/gi, "haven't"],
  [/\bhad not\b/gi, "hadn't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bdo not\b/gi, "don't"],
  [/\bdid not\b/gi, "didn't"],
  [/\bwill not\b/gi, "won't"],
  [/\bwould not\b/gi, "wouldn't"],
  [/\bshould not\b/gi, "shouldn't"],
  [/\bcould not\b/gi, "couldn't"],
  [/\bcannot\b/gi, "can't"],
];

function applyPairs(text: string, pairs: Array<[RegExp, string]>): string {
  let out = text;
  for (const [re, rep] of pairs) {
    out = out.replace(re, rep);
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1");
}

/** Abbreviations after which a period does NOT end a sentence. */
const ABBREVIATIONS =
  /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|dept|est|fig|no|vol|al)\.$/i;

/**
 * Splits into sentences without breaking inside URLs, decimals, or
 * abbreviations. A terminator only ends a sentence when it is followed by
 * whitespace (or end of input); "example.com" and "3.5" have no space
 * after the period, so they stay intact.
 */
function splitSentencesKeep(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (ch === "." || ch === "!" || ch === "?") {
      // consume any run of terminators (e.g. "?!", "...")
      while (i + 1 < text.length && /[.!?]/.test(text[i + 1])) {
        buf += text[++i];
      }
      const rest = text.slice(i + 1);
      const endsInput = rest.trim() === "";
      const followedBySpace = /^\s/.test(rest);
      if ((endsInput || followedBySpace) && !ABBREVIATIONS.test(buf.trim())) {
        out.push(buf.trim());
        buf = "";
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text.trim()];
}

/**
 * Words that are capitalised because they are names/proper nouns rather
 * than because they start a sentence. Conservative list — days, months
 * and common title words cover most real cases.
 */
const PROPER_NOUN_HINT =
  /^(?:mon|tues|wednes|thurs|fri|satur|sun)day$|^(?:january|february|march|april|may|june|july|august|september|october|november|december)$|^(?:mr|mrs|ms|dr|prof)$/i;

/** Common verbs/auxiliaries used as a cheap "does this clause have a predicate?" test. */
const VERB_HINT =
  /\b(is|are|was|were|be|been|being|am|has|have|had|do|does|did|will|would|can|could|should|shall|may|might|must|went|got|made|said|took|came|saw|knew|thought|found|gave|told|became|left|felt|put|brought|began|kept|held|wrote|stood|heard|let|meant|set|met|ran|paid|sat|spoke|lay|led|grew|lost|fell|sent|built|understood|drew|broke|spent|cut|rose|drove|bought|wore|chose|[a-z]+(?:ed|es|s))\b/i;

/** Pronoun/determiner openers that suggest a clause has its own subject. */
const SUBJECT_HINT =
  /^(?:i|you|he|she|it|we|they|this|that|these|those|there|the|a|an|my|your|his|her|its|our|their|one|some|many|most|few|all|each|every|no|nobody|someone|everyone)\b/i;

/**
 * Heuristic test for whether a fragment can stand as its own sentence.
 * Deliberately conservative: when unsure, we do not split.
 */
function isIndependentClause(piece: string): boolean {
  const trimmed = piece.trim().replace(/[.!?]+$/, "");
  const w = wordsOf(trimmed);
  if (w.length < 4) return false;
  return SUBJECT_HINT.test(trimmed) && VERB_HINT.test(trimmed);
}

function adjustSentenceLength(text: string, targetAvg: number): string {
  const sentences = splitSentencesKeep(text);
  if (sentences.length === 0) return text;

  const currentAvg =
    wordsOf(text).length / Math.max(sentences.length, 1);

  // Too long vs target → split, but ONLY at a genuine clause boundary.
  //
  // The previous version split on any "and"/"but"/";" and produced
  // fragments: "I bought salt and pepper and some bread" became
  // "I bought salt. Pepper. Some bread." A candidate piece is only
  // accepted as a sentence if it looks like an independent clause —
  // it must start with a subject-ish token and contain a verb-ish token,
  // and be long enough to stand alone.
  if (currentAvg > targetAvg + 6) {
    const next: string[] = [];
    for (const s of sentences) {
      const pieces = s.split(/\s*(?:;|,\s+(?:and|but))\s+/i);
      const longEnough = wordsOf(s).length > targetAvg + 4;
      if (pieces.length > 1 && longEnough && pieces.every(isIndependentClause)) {
        for (let i = 0; i < pieces.length; i++) {
          let piece = pieces[i].trim();
          if (!/[.!?]$/.test(piece)) {
            piece +=
              i === pieces.length - 1 && /[.!?]$/.test(s) ? s.slice(-1) : ".";
          }
          next.push(capitalize(piece));
        }
      } else {
        next.push(s);
      }
    }
    return next.join(" ");
  }

  // Too short vs target → gently join short neighbors
  if (currentAvg < targetAvg - 6 && sentences.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < sentences.length; i++) {
      const cur = sentences[i];
      const nxt = sentences[i + 1];
      if (
        nxt &&
        wordsOf(cur).length < 10 &&
        wordsOf(nxt).length < 14 &&
        !/[?]$/.test(cur)
      ) {
        const left = cur.replace(/[.!]$/, "");
        // Don't lowercase a word that is capitalised for its own reasons:
        // the pronoun "I", or a proper noun. Only downcase when the rest
        // of the word is lowercase and it isn't a standalone "I".
        const firstWord = nxt.split(/\s+/)[0]?.replace(/[^A-Za-z']/g, "") ?? "";
        const safeToLower =
          firstWord.length > 1 &&
          firstWord !== "I" &&
          firstWord.slice(1) === firstWord.slice(1).toLowerCase() &&
          !PROPER_NOUN_HINT.test(firstWord);
        const right = safeToLower
          ? nxt.charAt(0).toLowerCase() + nxt.slice(1)
          : nxt;
        next.push(`${left}, and ${right}`);
        i++;
      } else {
        next.push(cur);
      }
    }
    return next.join(" ");
  }

  return text;
}

/** A bullet / numbered list line, which must keep its marker and stay on its own line. */
const LIST_LINE = /^\s*(?:[-*+•]|\d+[.)])\s+/;

/**
 * Rewrites a document while preserving its structure.
 *
 * `rewriteOne` only ever sees a single paragraph or list item, so blank
 * lines, bullets and numbering survive. Previously the whole document was
 * flattened through `tidy`, which collapsed every paragraph break and
 * returned multi-page inputs as one unbroken line.
 */
export function rewriteToStyle(
  input: string,
  profile: StyleProfile | null,
): { rewritten: string; notes: string[] } {
  const source = String(input || "").trim();
  if (!source) {
    return { rewritten: "", notes: ["Add some text to rewrite."] };
  }

  const noteSet = new Set<string>();
  // Split into paragraphs, keeping the exact blank-line separators.
  const blocks = source.split(/(\n\s*\n)/);

  const rewritten = blocks
    .map((block) => {
      if (/^\n\s*\n$/.test(block)) return block; // separator, preserve as-is
      // Within a paragraph, rewrite list items line by line.
      const lines = block.split("\n");
      const anyList = lines.some((l) => LIST_LINE.test(l));
      if (anyList) {
        return lines
          .map((line) => {
            const marker = line.match(LIST_LINE)?.[0] ?? "";
            const body = line.slice(marker.length);
            if (!body.trim()) return line;
            const { text, notes } = rewriteOne(body, profile);
            notes.forEach((n) => noteSet.add(n));
            return `${marker}${text}`;
          })
          .join("\n");
      }
      if (!block.trim()) return block;
      const { text, notes } = rewriteOne(block, profile);
      notes.forEach((n) => noteSet.add(n));
      return text;
    })
    .join("");

  return { rewritten, notes: [...noteSet] };
}

function rewriteOne(
  input: string,
  profile: StyleProfile | null,
): { text: string; notes: string[] } {
  const notes: string[] = [];
  let text = String(input || "").trim();
  if (!text) {
    return { text: "", notes };
  }

  // Baseline humanization: strip AI-ish filler
  const before = text;
  text = applyPairs(text, [
    [/\bIn today's (?:fast-paced|digital) world,?\s*/gi, ""],
    [/\bIt is worth noting that\s*/gi, ""],
    [/\bIn summary,?\s*/gi, ""],
    [/\bOverall, it can be said that\s*/gi, ""],
    [/\bdelve into\b/gi, "look at"],
    [/\bnavigate the (?:complex )?landscape\b/gi, "handle"],
    [/\bplay a crucial role\b/gi, "matter"],
    [/\ba testament to\b/gi, "proof of"],
    [/\bunderscores the importance\b/gi, "shows the value"],
    [/\bin the realm of\b/gi, "in"],
    [/\bwhen it comes to\b/gi, "for"],
  ]);
  if (text !== before) notes.push("Removed common AI filler phrasing");

  if (!profile || profile.sampleCount === 0) {
    notes.push(
      "No writing samples yet — used general naturalization. Upload samples for a closer match to your voice.",
    );
    text = applyPairs(text, FORMAL_TO_CASUAL.slice(0, 12));
    return { text: tidy(text), notes };
  }

  if (profile.formalityScore < 0.45) {
    text = applyPairs(text, FORMAL_TO_CASUAL);
    notes.push("Shifted wording toward your more casual register");
  } else if (profile.formalityScore > 0.62) {
    text = applyPairs(text, CASUAL_TO_FORMAL);
    notes.push("Shifted wording toward your more formal register");
  } else {
    notes.push("Kept a balanced register matching your samples");
  }

  if (profile.contractionRate >= CONTRACTION_FREQUENT) {
    text = applyPairs(text, EXPAND_TO_CONTRACTION);
    notes.push("Applied contractions the way your samples do");
  } else if (profile.contractionRate < CONTRACTION_RARE) {
    text = applyPairs(text, CONTRACTION_EXPAND);
    notes.push("Expanded contractions to match your samples");
  }

  const adjusted = adjustSentenceLength(text, profile.avgSentenceLength);
  if (adjusted !== text) {
    notes.push(
      `Tuned sentence rhythm toward ~${Math.round(profile.avgSentenceLength)} words`,
    );
    text = adjusted;
  }

  if (profile.commonTransitions.length && profile.formalityScore >= 0.5) {
    // light touch: ensure at least one familiar transition if multi-sentence
    const sents = splitSentencesKeep(text);
    if (sents.length >= 3) {
      const t = profile.commonTransitions[0];
      if (t && !text.toLowerCase().includes(t)) {
        sents[1] = `${capitalize(t)}, ${sents[1].charAt(0).toLowerCase()}${sents[1].slice(1)}`;
        text = sents.join(" ");
        notes.push(`Wove in a transition you often use (“${t}”)`);
      }
    }
  }

  notes.push(...profile.toneNotes.slice(0, 2).map((n) => `Style cue: ${n}`));

  return { text: tidy(text), notes };
}

/**
 * Normalises whitespace and sentence capitalisation within a single block.
 *
 * The capitalisation rule only fires on a genuine sentence boundary:
 * punctuation followed by whitespace. The old `([.!?])\s*([a-z])` pattern
 * matched zero whitespace, so "example.com" became "Example. Com" and
 * "3.5" / "e.g." were mangled the same way.
 */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(
      // require real whitespace after the terminator
      /([.!?])(\s+)([a-z])/g,
      (match, punct: string, gap: string, ch: string, offset: number) => {
        const preceding = text.slice(Math.max(0, offset - 12), offset + 1);
        if (ABBREVIATIONS.test(preceding)) return match;
        return `${punct}${gap}${ch.toUpperCase()}`;
      },
    )
    .replace(/^\s*[a-z]/, (c) => c.toUpperCase())
    .trim();
}
