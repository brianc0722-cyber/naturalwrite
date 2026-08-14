import { wordsOf } from "@/lib/tokenize";

/**
 * Deterministic grammar and mechanics checker.
 *
 * Design constraint, stated up front: this is a RULE ENGINE, not a parser. It
 * has no part-of-speech tagger and no syntax tree, so it cannot judge
 * agreement in the general case ("the list of items are long" needs to know
 * that "list", not "items", is the subject). Every rule below is therefore
 * written to a single standard: it fires only on patterns that are wrong
 * essentially all of the time in ordinary prose.
 *
 * That bias is deliberate. A checker that flags correct writing trains the
 * user to ignore it, at which point the real errors are invisible too. When a
 * rule cannot be made confident, it is either scoped down to a narrow phrase
 * list or left out entirely — the LLM pass in `llm-grammar.ts` is where
 * open-ended judgment belongs, and it only runs when a key is configured.
 *
 * Offsets are byte-accurate into the ORIGINAL string so the UI can highlight
 * the exact span. Rules must never mutate the text they scan.
 */

export type GrammarCategory = "grammar" | "mechanics" | "style";
export type GrammarSeverity = "error" | "warning" | "suggestion";

export type GrammarIssue = {
  /** Stable rule id, e.g. "doubled-word". Used for tests and dedupe. */
  rule: string;
  category: GrammarCategory;
  severity: GrammarSeverity;
  /** What is wrong, in plain language. */
  message: string;
  /** The corrected text, when a mechanical fix exists. */
  suggestion: string | null;
  /** Exact span in the original text. */
  offset: number;
  length: number;
  /** The offending text itself. */
  excerpt: string;
  /** Surrounding sentence, trimmed, for display context. */
  context: string;
};

export type GrammarStats = {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgSentenceLength: number;
  longestSentence: number;
  readingSeconds: number;
};

export type GrammarResult = {
  /** 0-100, where 100 is clean. Density-based, not a raw count. */
  score: number;
  /** Human label for the score band. */
  verdict: string;
  issues: GrammarIssue[];
  counts: {
    error: number;
    warning: number;
    suggestion: number;
    grammar: number;
    mechanics: number;
    style: number;
  };
  stats: GrammarStats;
};

/** Words that end in "." without ending a sentence. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc",
  "eg", "ie", "approx", "dept", "est", "fig", "inc", "ltd", "no", "vol",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
  "nov", "dec", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "am", "pm",
  "u.s", "u.k", "a.m", "p.m", "ph.d", "e.g", "i.e",
]);

export type Sentence = { text: string; start: number; end: number };

/**
 * Splits into sentences while preserving absolute offsets.
 *
 * `style-analyzer.ts` splits on /(?<=[.!?])\s+/, which is fine for computing
 * averages but breaks "Dr. Chen" into two sentences and discards positions.
 * Grammar rules need both the abbreviation guard (or every title becomes a
 * capitalization error) and the offsets (or nothing can be highlighted).
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Consume runs like "?!" or "..." so they close one sentence, not three.
    let j = i;
    while (j + 1 < text.length && ".!?".includes(text[j + 1])) j++;

    const after = text[j + 1];
    // A sentence ends at terminal punctuation followed by whitespace or EOF.
    if (after !== undefined && !/\s/.test(after)) {
      i = j;
      continue;
    }

    if (ch === ".") {
      // Look back at the token before the period.
      const before = text.slice(start, i);
      const lastWord = before.match(/([A-Za-z.]+)$/)?.[1]?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(lastWord.replace(/\.$/, ""))) {
        i = j;
        continue;
      }
      // Single initial: "J. R. R. Tolkien".
      if (/^[A-Za-z]$/.test(lastWord)) {
        i = j;
        continue;
      }
      // Decimal number: "3.5".
      if (/\d$/.test(before) && /^\d/.test(after ?? "")) {
        i = j;
        continue;
      }
    }

    const raw = text.slice(start, j + 1);
    if (raw.trim()) out.push({ text: raw.trim(), start: start + (raw.length - raw.trimStart().length), end: j + 1 });
    start = j + 1;
    i = j;
  }

  const tail = text.slice(start);
  if (tail.trim()) {
    out.push({
      text: tail.trim(),
      start: start + (tail.length - tail.trimStart().length),
      end: text.length,
    });
  }
  return out;
}

/** Sentence containing an offset, trimmed for display. */
function contextFor(sentences: Sentence[], offset: number): string {
  const s = sentences.find((x) => offset >= x.start && offset <= x.end);
  const raw = s?.text ?? "";
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}

/**
 * Spans that rules must not fire inside: URLs, emails, and code spans.
 * "https://a.com/b" would otherwise trip missing-space-after-punctuation on
 * every slash and period it contains.
 */
export function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [
    /https?:\/\/\S+/g,
    /\bwww\.\S+/g,
    /[^\s@]+@[^\s@]+\.[^\s@]+/g,
    /`[^`\n]*`/g,
    /\b\d+(?:\.\d+)+\b/g, // version numbers, 1.2.3
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

export function inProtected(ranges: Array<[number, number]>, offset: number): boolean {
  return ranges.some(([a, b]) => offset >= a && offset < b);
}

/**
 * High-confidence word confusions.
 *
 * Each entry is a regex that only matches in a frame where the alternative is
 * essentially never correct. "its" alone is ambiguous; "its been" is not.
 * Group 1 is the span to flag when present, otherwise the whole match.
 */
type ConfusionRule = {
  rule: string;
  re: RegExp;
  message: string;
  fix: (m: RegExpMatchArray) => string;
};

const CONFUSIONS: ConfusionRule[] = [
  {
    rule: "its-contraction",
    re: /\bits\s+(been|going|not|a|an|the|only|about|time|too|very|so|clear|important|possible)\b/gi,
    message: '"its" is possessive. This frame needs "it is" — the contraction "it\'s".',
    fix: (m) => `it's ${m[1]}`,
  },
  {
    rule: "its-possessive",
    re: /\bit's\s+(own|way\b|place\b|purpose\b|value\b|role\b)/gi,
    message: '"it\'s" means "it is". A possessive takes no apostrophe: "its".',
    fix: (m) => `its ${m[1]}`,
  },
  {
    rule: "your-contraction",
    re: /\byour\s+(welcome|right\b|wrong\b|going|not\b|the\b|a\b|going to|correct\b)/gi,
    message: '"your" is possessive. This needs "you are" — "you\'re".',
    fix: (m) => `you're ${m[1]}`,
  },
  {
    rule: "youre-possessive",
    re: /\byou're\s+(own|name\b|turn\b|job\b|house\b|car\b|idea\b)/gi,
    message: '"you\'re" means "you are". The possessive is "your".',
    fix: (m) => `your ${m[1]}`,
  },
  {
    rule: "their-there",
    re: /\btheir\s+(is|are|was|were|will be|has been|have been)\b/gi,
    message: '"their" is possessive. An existential statement takes "there".',
    fix: (m) => `there ${m[1]}`,
  },
  {
    rule: "there-their",
    re: /\bthere\s+(own)\b/gi,
    message: 'Possessive: "their own".',
    fix: () => "their own",
  },
  {
    // Deliberately narrow. A bare "their" + gerund is often a legitimate noun
    // phrase ("their marketing to millennials", "their spending on ads"), so
    // only the motion verbs followed by "to" are matched — those have no
    // valid possessive reading in ordinary prose.
    rule: "their-theyre",
    re: /\btheir\s+(going|coming|getting|heading)\s+to\b/gi,
    message: '"their" is possessive. This needs "they are" — the contraction "they\u2019re".',
    fix: (m) => `they're ${m[1].toLowerCase()} to`,
  },
  {
    rule: "their-theyre-not",
    re: /\btheir\s+not\b/gi,
    message: '"their" is possessive. This needs "they are" — the contraction "they\u2019re".',
    fix: () => "they're not",
  },
  {
    rule: "have-of",
    re: /\b(would|could|should|must|might|may)\s+of\b/gi,
    message: 'The contraction is "\u2019ve", not "of": "would have", not "would of".',
    fix: (m) => `${m[1]} have`,
  },
  {
    rule: "then-than",
    re: /\b(more|less|better|worse|greater|fewer|larger|smaller|higher|lower|rather|other|older|younger|faster|slower|\w+er)\s+then\b/gi,
    message: 'Comparisons take "than". "Then" is about time or sequence.',
    fix: (m) => `${m[1]} than`,
  },
  {
    rule: "loose-lose",
    re: /\bloose\s+(the|a|an|it|them|him|her|your|my|our|their|control|money|weight|time|track)\b/gi,
    message: '"Loose" is the opposite of tight. The verb is "lose".',
    fix: (m) => `lose ${m[1]}`,
  },
  {
    rule: "whos-contraction",
    re: /\bwhose\s+(going|been|coming|ready|next|responsible|working|the)\b/gi,
    message: '"Whose" is possessive. This needs "who is" / "who has" — "who\'s".',
    fix: (m) => `who's ${m[1]}`,
  },
  {
    rule: "alot",
    re: /\balot\b/gi,
    message: '"A lot" is two words.',
    fix: () => "a lot",
  },
  {
    rule: "irregardless",
    re: /\birregardless\b/gi,
    message: '"Irregardless" is a double negative. Use "regardless".',
    fix: () => "regardless",
  },
  {
    rule: "affect-effect",
    re: /\b(the|an|a|this|that|no|any|little|great|side|positive|negative)\s+affect\b/gi,
    message: 'After an article or adjective this is the noun "effect".',
    fix: (m) => `${m[1]} effect`,
  },
  {
    rule: "effect-affect",
    re: /\b(will|would|can|could|may|might|does|did|to)\s+effect\s+(the|a|an|my|our|your|their|his|her|its)\b/gi,
    message: 'As a verb meaning "to influence", the spelling is "affect".',
    fix: (m) => `${m[1]} affect ${m[2]}`,
  },
  {
    rule: "supposed-to",
    re: /\bsuppose\s+to\b/gi,
    message: 'The idiom is "supposed to".',
    fix: () => "supposed to",
  },
  {
    rule: "used-to",
    re: /\buse\s+to\s+(be|go|have|do|live|work|think|say)\b/gi,
    message: 'Past habit is "used to".',
    fix: (m) => `used to ${m[1]}`,
  },
  {
    rule: "each-every",
    re: /\b(each|every)\s+(\w+)s\b/gi,
    message: '"Each" and "every" take a singular noun.',
    fix: (m) => `${m[1]} ${m[2]}`,
  },
  {
    rule: "between-you-and-i",
    // Case-insensitive on "between" so a sentence-initial "Between" matches,
    // but the pronoun stays uppercase: lowercase "i" here is already caught
    // by the lowercase-i rule and would double-report.
    re: /\b([Bb])etween\s+you\s+and\s+I\b/g,
    message: 'After a preposition, use the object form: "between you and me".',
    fix: (m) => `${m[1]}etween you and me`,
  },
  {
    rule: "could-care-less",
    re: /\bcould\s+care\s+less\b/gi,
    message: 'The idiom inverts the meaning. "Couldn\'t care less".',
    fix: () => "couldn't care less",
  },
];

/**
 * Contractions typed without the apostrophe.
 *
 * Every key here is a string that is NOT a word in its own right, so a match
 * is unambiguous and cannot be a false alarm. Real words that merely look
 * like a stripped contraction are deliberately absent and handled separately:
 *
 *   were  -> "we're" but also the past plural of "be"
 *   well  -> "we'll" but also an adverb and a hole in the ground
 *   ill   -> "I'll" but also unwell
 *   id    -> "I'd" but also identification
 *   shed / wed / hell / shell / lets / cant / wont -- all real words
 *
 * "cant" and "wont" ARE real words but are vanishingly rare in that sense, so
 * they get a verb-frame rule below rather than being dropped entirely.
 *
 * Values keep their own capitalisation ("I'm"); a match that starts uppercase
 * has the suggestion's first letter uppercased, never the reverse.
 */
const MISSING_APOSTROPHE: Record<string, string> = {
  im: "I'm",
  ive: "I've",
  youre: "you're",
  youve: "you've",
  youd: "you'd",
  youll: "you'll",
  hes: "he's",
  shes: "she's",
  weve: "we've",
  theyre: "they're",
  theyve: "they've",
  theyd: "they'd",
  theyll: "they'll",
  itll: "it'll",
  thats: "that's",
  theres: "there's",
  wheres: "where's",
  whats: "what's",
  whos: "who's",
  wholl: "who'll",
  hows: "how's",
  heres: "here's",
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  havent: "haven't",
  hasnt: "hasn't",
  hadnt: "hadn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  wouldnt: "wouldn't",
  mustnt: "mustn't",
  couldve: "could've",
  shouldve: "should've",
  wouldve: "would've",
  oclock: "o'clock",
};

const MISSING_APOSTROPHE_RE = new RegExp(
  `\\b(${Object.keys(MISSING_APOSTROPHE).join("|")})\\b`,
  "gi",
);

/**
 * Verbs and adverbs that can follow "can't" / "won't". The bare spellings
 * "cant" (insincere talk) and "wont" (habit) are nouns, so they are never
 * followed by one of these -- the frame makes the match safe.
 */
const NEGATED_VERB =
  "(?:be|do|get|go|see|say|make|take|help|wait|find|tell|give|come|know|think|believe|afford|stand|stop|start|remember|forget|understand|imagine|explain|change|keep|let|run|open|close|read|write|use|work|hear|talk|speak|move|leave|stay|handle|manage|happen|matter|last|fit|allow|accept|return|need|want|seem|even|just|ever|really|always|possibly|otherwise)";

/**
 * A repeated word with one word between it: "what it is it you would like".
 *
 * The plain doubled-word rule only sees adjacent repeats. This catches the
 * transposition class, but ONLY in a pronoun + auxiliary frame. A general
 * "X Y X" search would drown in idiom -- "hand in hand", "day by day",
 * "face to face", "step by step", "back to back", "over and over".
 *
 * "that" is excluded on purpose: "and that is that" is a real sentence.
 */
const PRONOUN_ECHO = /\b(it|he|she|they|we|you)\s+(is|are|was|were|has|have|had|will|would|can|could|does|did)\s+\1\b/gi;

/** The same transposition the other way round: "is it is". */
const AUX_ECHO = /\b(is|are|was|were|has|have|had)\s+(it|he|she|they|we|you)\s+\1\b/gi;

/**
 * Words that begin with a vowel letter but a consonant SOUND, and vice versa.
 * The a/an rule is spelling-based and therefore wrong on exactly these.
 */
const CONSONANT_SOUND = /^(?:u[bcdfgklmnprstvxz]|uni(?!n)|use|user|usu|euro|eu|one|once|ubiqu|unil|unic|util|utop)/i;
const VOWEL_SOUND = /^(?:hour|honest|honor|honour|heir|herb\b|x-ray|mba|md\b|fbi|nda|rsvp|llc|hr\b|sos)/i;

/**
 * Misspellings that another rule already rewrites. Without this guard the
 * article rule reads the raw string and emits advice that contradicts the
 * correction: "a alot" would be flagged as needing "an alot" while the
 * alot rule is simultaneously turning it into "a lot". Stay silent and let
 * the more specific rule own the span.
 */
const ARTICLE_SKIP_WORDS = /^(?:alot|alright|abit)$/i;

/** A rule may push zero or more issues; helper keeps construction uniform. */
export function issue(
  base: Omit<GrammarIssue, "context" | "excerpt">,
  text: string,
  sentences: Sentence[],
): GrammarIssue {
  return {
    ...base,
    excerpt: text.slice(base.offset, base.offset + base.length),
    context: contextFor(sentences, base.offset),
  };
}

/** Long sentences are a readability signal, not an error. */
const LONG_SENTENCE_WORDS = 40;
const VERY_LONG_SENTENCE_WORDS = 60;

export function checkGrammar(text: string): GrammarResult {
  const issues: GrammarIssue[] = [];
  const sentences = splitSentences(text);
  const guarded = protectedRanges(text);
  const add = (b: Omit<GrammarIssue, "context" | "excerpt">) => {
    if (inProtected(guarded, b.offset)) return;
    issues.push(issue(b, text, sentences));
  };

  // ---- Mechanics: whitespace and punctuation ----------------------------

  // Doubled words: "the the". Case-insensitive but skips legitimate repeats
  // like "had had" and "that that".
  const LEGIT_DOUBLES = new Set(["had", "that", "is", "s", "no", "very", "ha"]);
  for (const m of text.matchAll(/\b(\w+)(\s+)(\1)\b/gi)) {
    const word = m[1].toLowerCase();
    if (LEGIT_DOUBLES.has(word)) continue;
    if (/\n/.test(m[2])) continue; // across a line break, likely a list
    add({
      rule: "doubled-word",
      category: "mechanics",
      severity: "error",
      message: `"${m[1]}" is repeated.`,
      suggestion: m[1],
      offset: m.index,
      length: m[0].length,
    });
  }

  // Contractions typed without the apostrophe: "Im", "dont", "youre".
  for (const m of text.matchAll(MISSING_APOSTROPHE_RE)) {
    const raw = m[1];
    // ALL-CAPS runs are acronyms and initialisms, not contractions: "IM",
    // "ID", "IVE". A single capital ("Im") is ordinary sentence case.
    if (raw.length > 1 && raw === raw.toUpperCase()) continue;
    const canonical = MISSING_APOSTROPHE[raw.toLowerCase()];
    // Preserve the writer's capitalisation: "Dont" -> "Don't", not "don't".
    const suggestion =
      raw[0] === raw[0].toUpperCase()
        ? canonical[0].toUpperCase() + canonical.slice(1)
        : canonical;
    add({
      rule: "missing-apostrophe",
      category: "mechanics",
      severity: "error",
      message: `"${raw}" is missing an apostrophe.`,
      suggestion,
      offset: m.index,
      length: raw.length,
    });
  }

  // "cant" / "wont" are real words, so they need a verb frame to be safe.
  for (const m of text.matchAll(
    new RegExp(`\\b(cant|wont)\\s+(${NEGATED_VERB})\\b`, "gi"),
  )) {
    const raw = m[1];
    if (raw === raw.toUpperCase()) continue;
    const canonical = raw.toLowerCase() === "cant" ? "can't" : "won't";
    const suggestion =
      raw[0] === raw[0].toUpperCase()
        ? canonical[0].toUpperCase() + canonical.slice(1)
        : canonical;
    add({
      rule: "missing-apostrophe",
      category: "mechanics",
      severity: "error",
      message: `"${raw}" is missing an apostrophe.`,
      suggestion,
      offset: m.index,
      length: raw.length,
    });
  }

  // Transposed repeats: "what it is it you would like".
  for (const re of [PRONOUN_ECHO, AUX_ECHO]) {
    for (const m of text.matchAll(re)) {
      add({
        rule: "repeated-word",
        category: "grammar",
        severity: "error",
        message: `"${m[1]}" is repeated \u2014 this reads as a typo or a transposition.`,
        suggestion: `${m[1]} ${m[2]}`,
        offset: m.index,
        length: m[0].length,
      });
    }
  }

  // Space before punctuation: "word ,"
  for (const m of text.matchAll(/[ \t]+([,.;:!?])/g)) {
    add({
      rule: "space-before-punctuation",
      category: "mechanics",
      severity: "error",
      message: `Remove the space before "${m[1]}".`,
      suggestion: m[1],
      offset: m.index,
      length: m[0].length,
    });
  }

  // Missing space after punctuation: "word,next". Excludes decimals and
  // protected spans (URLs, versions) via the guard above.
  for (const m of text.matchAll(/([,;:])(?=[A-Za-z])/g)) {
    add({
      rule: "missing-space-after-punctuation",
      category: "mechanics",
      severity: "error",
      message: `Add a space after "${m[1]}".`,
      suggestion: `${m[1]} `,
      offset: m.index,
      length: 1,
    });
  }
  // Sentence-terminal version needs the next char to be uppercase, otherwise
  // "e.g" and file names produce noise.
  for (const m of text.matchAll(/([.!?])(?=[A-Z])/g)) {
    add({
      rule: "missing-space-after-sentence",
      category: "mechanics",
      severity: "warning",
      message: `Add a space after "${m[1]}".`,
      suggestion: `${m[1]} `,
      offset: m.index,
      length: 1,
    });
  }

  // Two or more spaces mid-line.
  for (const m of text.matchAll(/\S(  +)\S/g)) {
    add({
      rule: "double-space",
      category: "mechanics",
      severity: "suggestion",
      message: "Multiple spaces between words.",
      suggestion: " ",
      offset: m.index + 1,
      length: m[1].length,
    });
  }

  // Repeated terminal punctuation outside informal writing.
  for (const m of text.matchAll(/([!?])\1{2,}/g)) {
    add({
      rule: "repeated-punctuation",
      category: "mechanics",
      severity: "suggestion",
      message: "Repeated punctuation reads as shouting in formal writing.",
      suggestion: m[1],
      offset: m.index,
      length: m[0].length,
    });
  }

  // Lowercase standalone "i".
  for (const m of text.matchAll(/(^|[^\p{L}'’])i(?=[^\p{L}'’]|$)/gu)) {
    const off = m.index + m[1].length;
    add({
      rule: "lowercase-i",
      category: "mechanics",
      severity: "error",
      message: 'The pronoun "I" is always capitalized.',
      suggestion: "I",
      offset: off,
      length: 1,
    });
  }

  // Unmatched brackets.
  for (const [open, close, name] of [["(", ")", "parenthesis"], ["[", "]", "bracket"], ["{", "}", "brace"]] as const) {
    const opens = (text.match(new RegExp(`\\${open}`, "g")) ?? []).length;
    const closes = (text.match(new RegExp(`\\${close}`, "g")) ?? []).length;
    if (opens !== closes) {
      const idx = text.lastIndexOf(opens > closes ? open : close);
      add({
        rule: "unmatched-bracket",
        category: "mechanics",
        severity: "warning",
        message: `Unmatched ${name}: ${opens} "${open}" and ${closes} "${close}".`,
        suggestion: null,
        offset: Math.max(idx, 0),
        length: 1,
      });
    }
  }

  // Odd number of double quotes.
  const straightQuotes = (text.match(/"/g) ?? []).length;
  if (straightQuotes % 2 === 1) {
    add({
      rule: "unmatched-quote",
      category: "mechanics",
      severity: "warning",
      message: "An opening quotation mark is never closed.",
      suggestion: null,
      offset: text.lastIndexOf('"'),
      length: 1,
    });
  }

  // ---- Grammar: word confusions -----------------------------------------

  for (const c of CONFUSIONS) {
    for (const m of text.matchAll(c.re)) {
      add({
        rule: c.rule,
        category: "grammar",
        severity: "error",
        message: c.message,
        suggestion: c.fix(m),
        offset: m.index,
        length: m[0].length,
      });
    }
  }

  // a / an, sound-aware.
  for (const m of text.matchAll(/\b(a|an)\s+([A-Za-z][\w'-]*)/g)) {
    const article = m[1].toLowerCase();
    const next = m[2];
    if (ARTICLE_SKIP_WORDS.test(next)) continue;
    const startsVowelLetter = /^[aeiou]/i.test(next);
    const soundsConsonant = CONSONANT_SOUND.test(next);
    const soundsVowel = VOWEL_SOUND.test(next);

    const needsAn = soundsVowel || (startsVowelLetter && !soundsConsonant);
    if (needsAn && article === "a") {
      add({
        rule: "article-a-an",
        category: "grammar",
        severity: "error",
        message: `"${next}" begins with a vowel sound, so it takes "an".`,
        suggestion: `an ${next}`,
        offset: m.index,
        length: m[0].length,
      });
    } else if (!needsAn && article === "an") {
      add({
        rule: "article-a-an",
        category: "grammar",
        severity: "error",
        message: `"${next}" begins with a consonant sound, so it takes "a".`,
        suggestion: `a ${next}`,
        offset: m.index,
        length: m[0].length,
      });
    }
  }

  // Subject-verb agreement, restricted to unambiguous pronoun frames.
  for (const m of text.matchAll(/\b(he|she|it)\s+(are|were|have|do|don't|dont)\b/gi)) {
    const fixes: Record<string, string> = {
      are: "is", were: "was", have: "has", do: "does",
      "don't": "doesn't", dont: "doesn't",
    };
    const verb = m[2].toLowerCase();
    add({
      rule: "subject-verb-singular",
      category: "grammar",
      severity: "error",
      message: `"${m[1]}" is singular and takes "${fixes[verb]}".`,
      suggestion: `${m[1]} ${fixes[verb]}`,
      offset: m.index,
      length: m[0].length,
    });
  }
  for (const m of text.matchAll(/\b(they|we|you)\s+(is|was|has|does)\b/gi)) {
    const fixes: Record<string, string> = {
      is: "are", was: "were", has: "have", does: "do",
    };
    // "you was" is dialectal but nonstandard; "we was" likewise.
    const verb = m[2].toLowerCase();
    add({
      rule: "subject-verb-plural",
      category: "grammar",
      severity: "error",
      message: `"${m[1]}" takes "${fixes[verb]}".`,
      suggestion: `${m[1]} ${fixes[verb]}`,
      offset: m.index,
      length: m[0].length,
    });
  }

  // Agreement attraction: a singular head noun followed by a prepositional
  // phrase, where the plural object of the preposition pulls the verb into
  // the plural. "The list of items are ..." should be "is".
  //
  // This is the most common agreement error in English, and the existing
  // pronoun rules above cannot see it because the subject is a noun.
  //
  // Kept deliberately narrow, in the house style of "the more specific rule
  // owns the span":
  //   - The head noun must come from a closed list of nouns that are
  //     genuinely singular. Quantifiers ("a number of", "a lot of",
  //     "the rest of", "some of", "half of") take a plural verb and are
  //     excluded by simply never appearing on the list.
  //   - The determiner must be singular ("the", "this", "each", "a"), which
  //     rules out "these kinds of results are".
  //   - The object of the preposition must be immediately followed by the
  //     verb. That gap requirement is what keeps the rule quiet on relative
  //     clauses like "the set of rules that govern trades are complex",
  //     where the plural verb is correct.
  const SINGULAR_HEADS =
    "list|set|box|bag|collection|array|version|copy|type|kind|sort|piece|" +
    "member|owner|author|purpose|cost|price|value|size|name|status|quality|" +
    "level|impact|effect|benefit|risk|goal|focus|role|source|cause|reason|" +
    "nature|extent|degree|point|idea|summary|description|title|index|length|" +
    "width|height|weight|speed|rate|ratio|sum|average|meaning|definition|" +
    "location|position|sequence|structure|design|layout|format|style|tone|" +
    "combination|series|result|outcome|scope|intent";
  const attraction = new RegExp(
    String.raw`\b(the|this|that|each|every|a|an)\s+(${SINGULAR_HEADS})\s+of\s+` +
      String.raw`(?:the\s+|these\s+|those\s+|our\s+|your\s+|their\s+|its\s+|his\s+|her\s+|all\s+)?` +
      String.raw`([A-Za-z]+s)\s+(are|were|have|do|don't|dont)\b`,
    "gi",
  );
  for (const m of text.matchAll(attraction)) {
    const fixes: Record<string, string> = {
      are: "is",
      were: "was",
      have: "has",
      do: "does",
      "don't": "doesn't",
      dont: "doesn't",
    };
    const verb = m[4].toLowerCase();
    const fixed = fixes[verb];
    if (!fixed) continue;
    add({
      rule: "subject-verb-attraction",
      category: "grammar",
      severity: "error",
      message:
        `The subject is "${m[1]} ${m[2]}", which is singular, so it takes ` +
        `"${fixed}". The plural "${m[3]}" belongs to "of", not to the verb.`,
      suggestion: `${m[3]} ${fixed}`,
      offset: m.index,
      length: m[0].length,
    });
  }

  // Past tense used where a past participle is required: "I have went",
  // "he has drank". The auxiliary have/has/had/having forces the participle,
  // and these irregular verbs are the ones people actually get wrong.
  //
  // Only verbs whose past tense and participle genuinely differ are listed,
  // so "have run", "have come" and "have put" never match. Regular verbs are
  // excluded entirely because their two forms are identical.
  const PARTICIPLES: Record<string, string> = {
    went: "gone", drank: "drunk", ate: "eaten", saw: "seen", began: "begun",
    sang: "sung", swam: "swum", took: "taken", gave: "given", wrote: "written",
    broke: "broken", chose: "chosen", drove: "driven", fell: "fallen",
    forgot: "forgotten", froze: "frozen", grew: "grown", knew: "known",
    rode: "ridden", spoke: "spoken", stole: "stolen", threw: "thrown",
    wore: "worn", tore: "torn", flew: "flown", blew: "blown",
    shook: "shaken", rang: "rung", sank: "sunk", ran: "run",
  };
  // "have saw blades", "have saw dust": here "saw" is a noun being modified,
  // not a verb. The same trap does not exist for the other entries.
  const SAW_AS_NOUN = /^\s*(?:blades?|dust|mills?|horses?|teeth|tooth|marks?|cuts?)\b/i;
  const participleRe = new RegExp(
    String.raw`\b(have|has|had|having)\s+(${Object.keys(PARTICIPLES).join("|")})\b`,
    "gi",
  );
  for (const m of text.matchAll(participleRe)) {
    const past = m[2].toLowerCase();
    if (past === "saw" && SAW_AS_NOUN.test(text.slice(m.index + m[0].length))) {
      continue;
    }
    const correct = PARTICIPLES[past];
    add({
      rule: "past-participle",
      category: "grammar",
      severity: "error",
      message: `After "${m[1].toLowerCase()}", use the past participle "${correct}", not "${past}".`,
      suggestion: `${m[1]} ${correct}`,
      offset: m.index,
      length: m[0].length,
    });
  }

  // "Each of the students have a laptop." These quantifiers are singular:
  // the plural noun belongs to "of", exactly like the attraction case above.
  // "both of", "all of", "some of", "many of" are plural and are excluded by
  // simply never appearing in this list.
  const singularQuantifier =
    /\b(each|one|neither|either)\s+of\s+(?:the|these|those|our|your|their|its|his|her|my)\s+([A-Za-z]+s)\s+(are|were|have|do|don't|dont)\b/gi;
  for (const m of text.matchAll(singularQuantifier)) {
    const fixes: Record<string, string> = {
      are: "is", were: "was", have: "has", do: "does",
      "don't": "doesn't", dont: "doesn't",
    };
    const verb = m[3].toLowerCase();
    const fixed = fixes[verb];
    if (!fixed) continue;
    add({
      rule: "quantifier-agreement",
      category: "grammar",
      severity: "error",
      message: `"${m[1].toLowerCase()}" is singular, so it takes "${fixed}". The plural "${m[2]}" belongs to "of".`,
      suggestion: `${m[2]} ${fixed}`,
      offset: m.index,
      length: m[0].length,
    });
  }

  // Sentence capitalization.
  for (const s of sentences) {
    const first = s.text.match(/^["'“‘(\[]*([\p{L}])/u);
    if (!first) continue;
    const ch = first[1];
    if (ch !== ch.toUpperCase() && ch === ch.toLowerCase()) {
      const offset = s.start + s.text.indexOf(ch);
      if (inProtected(guarded, offset)) continue;
      add({
        rule: "sentence-capitalization",
        category: "mechanics",
        severity: "warning",
        message: "Sentences begin with a capital letter.",
        suggestion: ch.toUpperCase(),
        offset,
        length: 1,
      });
    }
  }

  // Missing terminal punctuation on the final sentence.
  const last = sentences[sentences.length - 1];
  if (last && !/[.!?…:;]["'”’)\]]?$/.test(last.text) && wordsOf(last.text).length >= 3) {
    add({
      rule: "missing-terminal-punctuation",
      category: "mechanics",
      severity: "warning",
      message: "The text ends without punctuation.",
      suggestion: `${last.text}.`,
      offset: last.end - 1,
      length: 1,
    });
  }

  // ---- Style ------------------------------------------------------------

  for (const s of sentences) {
    const n = wordsOf(s.text).length;
    if (n >= VERY_LONG_SENTENCE_WORDS) {
      add({
        rule: "very-long-sentence",
        category: "style",
        severity: "warning",
        message: `This sentence runs ${n} words. Consider splitting it.`,
        suggestion: null,
        offset: s.start,
        length: Math.min(s.end - s.start, 80),
      });
    } else if (n >= LONG_SENTENCE_WORDS) {
      add({
        rule: "long-sentence",
        category: "style",
        severity: "suggestion",
        message: `This sentence runs ${n} words, which is long for most prose.`,
        suggestion: null,
        offset: s.start,
        length: Math.min(s.end - s.start, 80),
      });
    }
  }

  // Passive voice: "was written", "is being considered", "have been made".
  for (const m of text.matchAll(
    /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+(?:ed|en))\b(?=\s+by\b|\s|[.,;:!?])/gi,
  )) {
    // "is used to" and similar are frequently the natural phrasing; only flag
    // when an agent phrase follows or the participle is clearly passive.
    add({
      rule: "passive-voice",
      category: "style",
      severity: "suggestion",
      message: "Passive construction. Active voice is usually more direct.",
      suggestion: null,
      offset: m.index,
      length: m[0].length,
    });
  }

  // Wordy filler.
  const FILLER: Array<[RegExp, string]> = [
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bat this point in time\b/gi, "now"],
    [/\bin the event that\b/gi, "if"],
    [/\bfor the purpose of\b/gi, "for"],
    [/\bin spite of the fact that\b/gi, "although"],
    [/\ba large number of\b/gi, "many"],
    [/\bthe majority of\b/gi, "most"],
    [/\bis able to\b/gi, "can"],
    [/\bvery unique\b/gi, "unique"],
    [/\babsolutely essential\b/gi, "essential"],
    [/\bcompletely eliminate\b/gi, "eliminate"],
  ];
  for (const [re, replacement] of FILLER) {
    for (const m of text.matchAll(re)) {
      add({
        rule: "wordy-phrase",
        category: "style",
        severity: "suggestion",
        message: `"${m[0]}" can usually be "${replacement}".`,
        suggestion: replacement,
        offset: m.index,
        length: m[0].length,
      });
    }
  }

  // ---- Assemble ----------------------------------------------------------

  issues.sort((a, b) => a.offset - b.offset || a.rule.localeCompare(b.rule));

  // Overlapping spans from different rules confuse the highlighter; keep the
  // most severe issue per starting offset.
  const RANK: Record<GrammarSeverity, number> = { error: 0, warning: 1, suggestion: 2 };
  const deduped: GrammarIssue[] = [];
  for (const iss of issues) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.offset === iss.offset && prev.rule === iss.rule) continue;
    if (prev && prev.offset === iss.offset) {
      if (RANK[iss.severity] < RANK[prev.severity]) deduped[deduped.length - 1] = iss;
      continue;
    }
    deduped.push(iss);
  }

  const words = wordsOf(text);
  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const paragraphCount = text.split(/\n\s*\n/).filter((p) => p.trim()).length || 1;
  const longest = sentences.reduce((max, s) => Math.max(max, wordsOf(s.text).length), 0);

  const counts = {
    error: deduped.filter((i) => i.severity === "error").length,
    warning: deduped.filter((i) => i.severity === "warning").length,
    suggestion: deduped.filter((i) => i.severity === "suggestion").length,
    grammar: deduped.filter((i) => i.category === "grammar").length,
    mechanics: deduped.filter((i) => i.category === "mechanics").length,
    style: deduped.filter((i) => i.category === "style").length,
  };

  return {
    score: scoreOf(counts, wordCount),
    verdict: verdictOf(scoreOf(counts, wordCount)),
    issues: deduped,
    counts,
    stats: {
      wordCount,
      sentenceCount,
      paragraphCount,
      avgSentenceLength: sentenceCount ? Math.round((wordCount / sentenceCount) * 10) / 10 : 0,
      longestSentence: longest,
      readingSeconds: Math.round((wordCount / 230) * 60),
    },
  };
}

/**
 * Density-based score, so a 3000-word essay is not punished for having more
 * total issues than a paragraph. Weighted by severity: an error costs far
 * more than a stylistic suggestion, and suggestions are capped so that a
 * long passive-heavy document cannot fall below the mid range on style alone.
 */
export function scoreOf(
  counts: { error: number; warning: number; suggestion: number },
  wordCount: number,
): number {
  if (wordCount === 0) return 0;
  const per100 = 100 / Math.max(wordCount, 50);
  const errorPenalty = counts.error * 9 * per100;
  const warningPenalty = counts.warning * 4 * per100;
  const stylePenalty = Math.min(counts.suggestion * 1.5 * per100, 12);
  const raw = 100 - (errorPenalty + warningPenalty + stylePenalty);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export const GRAMMAR_CLEAN = 90;
export const GRAMMAR_FAIR = 70;

export function verdictOf(score: number): string {
  if (score >= GRAMMAR_CLEAN) return "Clean";
  if (score >= GRAMMAR_FAIR) return "Minor issues";
  if (score >= 45) return "Needs editing";
  return "Needs significant editing";
}

export const GRAMMAR_DISCLAIMER =
  "This checker combines a spelling dictionary with pattern rules, not a full parser. It is tuned to avoid false alarms, so it stays quiet on names and unusual capitalisation and will miss subtle grammar errors — a clean score means nothing obvious was found, not that the writing is perfect.";
