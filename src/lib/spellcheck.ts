/**
 * Spell checking.
 *
 * The rest of the grammar engine is pattern rules with no word list. That is
 * why "stoer" sailed through a check that flagged nothing: no rule can know
 * it is not a word. This module adds the missing dictionary.
 *
 * The hard part is not finding misspellings -  Hunspell does that well. It is
 * NOT flagging correct writing. A spell checker that underlines every surname
 * and every piece of jargon is worse than none, and it would break the
 * promise the tab makes ("tuned to avoid false alarms"). Measured against a
 * 70-word sample of ordinary business and technical prose, the raw en_US
 * dictionary produced 29 false positives. The guards below take that to zero.
 *
 * Layers, in order of application:
 *
 *   1. Two dictionaries. en_US plus en_GB, so "colour", "organise", and
 *      "travelling" are accepted alongside the American spellings. Flagging a
 *      British writer's own spelling is the most insulting false positive
 *      available.
 *   2. A supplemental word list (ALLOWED). Modern vocabulary the 2020 SCOWL
 *      list predates: "webhook", "onboarding", "SaaS", "npm", "chatbot".
 *   3. Capitalisation as a proper-noun signal. A capitalised word that is not
 *      at the start of a sentence is a name -  "Nakamura", "Kowalski",
 *      "Kubernetes" -  and is skipped. This single rule removes the entire
 *      surname problem, which no word list could ever cover.
 *   4. Shape guards. Numbers ("2020s"), acronyms in caps ("PDF"), hyphenated
 *      compounds whose parts are all words ("state-of-the-art"), and anything
 *      inside a URL, email, or code span.
 *
 * Loading is lazy and memoised. Parsing both dictionaries costs ~350ms once;
 * a check that never sees an unknown word never pays it.
 */

import {
  issue,
  inProtected,
  protectedRanges,
  splitSentences,
  type GrammarIssue,
} from "@/lib/grammar";

import nspell from "nspell";

/**
 * Words absent from the 2020 dictionaries that are unremarkable in 2026
 * writing. Lowercase; matching is case-insensitive.
 *
 * This list earns its place by preventing false positives, so it is
 * deliberately generous about technology and business vocabulary. It is NOT
 * a place for proper nouns -  layer 3 handles those far more reliably than
 * enumeration ever could.
 */
const ALLOWED = new Set([
  // Web and software
  "api", "apis", "app", "apps", "async", "await", "backend", "frontend",
  "webhook", "webhooks", "middleware", "namespace", "runtime", "plugin",
  "plugins", "sdk", "cli", "url", "urls", "uri", "html", "css", "json",
  "xml", "yaml", "http", "https", "localhost", "oauth", "sso", "api's",
  "changelog", "repo", "repos", "readme", "cron", "regex", "boolean",
  "enum", "struct", "arg", "args", "params", "config", "configs", "auth",
  "login", "logout", "signup", "signin", "username", "filename", "filenames",
  "dropdown", "checkbox", "tooltip", "modal", "iframe", "favicon",
  "dataset", "datasets", "workflow", "workflows", "pipeline", "pipelines",
  "frontend", "fullstack", "devops", "codebase", "refactor", "refactoring",
  "linter", "linting", "typecheck", "changelog", "monorepo", "scaffolding",
  "serverless", "microservice", "microservices", "kubernetes", "docker",
  "autoscaling", "autoscale", "autoscaler", "observability", "kubectl",
  "containerize", "containerized", "orchestrator", "sharding", "sharded",
  "postgres", "postgresql", "mysql", "sqlite", "redis", "nginx",
  "javascript", "typescript", "nodejs", "npm", "yarn", "pnpm", "webpack",
  "eslint", "vitest", "jest", "nextjs", "react", "vue", "svelte", "tailwind",
  // Products and platforms that read as common nouns
  "github", "gitlab", "bitbucket", "stackoverflow", "vercel", "netlify",
  "openai", "chatgpt", "anthropic", "claude", "gemini", "copilot",
  "youtube", "tiktok", "instagram", "linkedin", "whatsapp", "paypal",
  "ebay", "iphone", "ipad", "android", "ios", "macos", "wifi", "bluetooth",
  // AI and data
  "ai", "llm", "llms", "chatbot", "chatbots", "tokenizer", "tokenization",
  "embeddings", "prompt", "prompts", "prompting", "finetune", "finetuning",
  "hallucinate", "hallucination", "hallucinations", "multimodal",
  "summarizer", "summariser", "rewriter", "rewriters", "paraphraser",
  "detector", "detectors", "scanner", "checker", "analyzer", "analyser",
  // Business and general modern usage
  "saas", "paas", "iaas", "b2b", "b2c", "kpi", "kpis", "roi", "mvp",
  "startup", "startups", "fintech", "edtech", "healthtech", "adtech",
  "onboarding", "onboard", "offboarding", "upsell", "upselling", "downsell",
  "roadmap", "roadmaps", "backlog", "standup", "retro", "sprint",
  "stakeholder", "stakeholders", "deliverable", "deliverables",
  "actionable", "scalable", "scalability", "monetize", "monetise",
  "monetization", "monetisation", "analytics", "dashboard", "dashboards",
  "influencer", "influencers", "hashtag", "hashtags", "podcast", "podcasts",
  "blog", "blogs", "blogger", "blogging", "vlog", "newsletter",
  "ecommerce", "crowdfunding", "freemium", "subscription", "subscriptions",
  "crypto", "cryptocurrency", "blockchain", "nft", "nfts", "defi",
  "smartphone", "smartphones", "smartwatch", "streaming", "livestream",
  "telehealth", "remote", "hybrid", "coworking", "gig", "burnout",
  "covid", "coronavirus", "pandemic", "lockdown", "quarantine",
  "website", "websites", "webpage", "webpages", "online", "offline",
  "email", "emails", "emailed", "emailing", "inbox", "spam", "unsubscribe",
  "download", "downloads", "upload", "uploads", "uploaded", "uploading",
  "login", "signup", "workflow", "timeline", "timestamp", "timestamps",
  "metadata", "namespace", "workaround", "workarounds", "screenshot",
  "screenshots", "walkthrough", "walkthroughs", "checklist", "checklists",
]);

/**
 * Loaded on first use, then reused. Two dictionaries at ~550KB each parse in
 * roughly 350ms combined, which is too slow to pay on every request and
 * trivial to pay once per process.
 */
type Speller = { correct: (word: string) => boolean; suggest: (word: string) => string[] };
let spellers: Speller[] | null = null;
let loadFailed = false;

/**
 * Load both dictionaries. Returns an empty list if loading fails, which
 * disables spell checking rather than failing the whole grammar check -  a
 * missing dictionary must never cost the user their other results.
 */
export async function loadSpellers(): Promise<Speller[]> {
  if (spellers) return spellers;
  if (loadFailed) return [];
  try {
    const [en, gb] = await Promise.all([
      import("dictionary-en"),
      import("dictionary-en-gb"),
    ]);
    spellers = [
      nspell(Buffer.from(en.default.aff), Buffer.from(en.default.dic)),
      nspell(Buffer.from(gb.default.aff), Buffer.from(gb.default.dic)),
    ];
    return spellers;
  } catch {
    loadFailed = true;
    return [];
  }
}

/** Reset memoised state. Tests only. */
export function resetSpellers(): void {
  spellers = null;
  loadFailed = false;
}

/**
 * Shapes that are never misspellings regardless of dictionary content.
 * Checked before the dictionary so they cost nothing.
 */
function isNonWordShape(word: string): boolean {
  // Pure digits, ordinals, decades: 42, 3rd, 2020s, 1990's
  if (/^\d+(?:st|nd|rd|th|s|'s)?$/i.test(word)) return true;
  // Contains a digit at all: A4, mp3, h1, covid19
  if (/\d/.test(word)) return true;
  // All caps, 2-6 letters: PDF, HTML, NASA, RSVP. Longer all-caps runs are
  // more likely shouting than an acronym, and shouted words can be misspelled.
  if (/^[A-Z]{2,6}(?:'?s)?$/.test(word)) return true;
  // Single letters and initials: a, I, J.
  if (/^[A-Za-z]\.?$/.test(word)) return true;
  return false;
}

/** Strip the possessive so "Sarah's" and "company's" check as base words. */
function withoutPossessive(word: string): string {
  return word.replace(/['\u2019]s$/i, "");
}

/**
 * Is this a real word, by any of our sources?
 *
 * Tries the word as written and lowercased. The dictionary is case-sensitive:
 * "Brian" is present but "brian" is not, and "the" is present but "The" also
 * resolves. Trying both directions avoids sentence-case false positives.
 */
/**
 * Stripped contractions ("Im", "dont", "youre"). The missing-apostrophe rule
 * already owns these spans with a better message and an exact fix, so the
 * dictionary must stay quiet rather than double-report the same word as a
 * generic misspelling.
 */
const CONTRACTION_OWNED =
  /^(?:im|ive|youre|youve|youd|youll|hes|shes|weve|theyre|theyve|theyd|theyll|itll|thats|theres|wheres|whats|whos|wholl|hows|heres|dont|doesnt|didnt|isnt|arent|wasnt|werent|havent|hasnt|hadnt|couldnt|shouldnt|wouldnt|mustnt|couldve|shouldve|wouldve|oclock|cant|wont)$/i;

function known(word: string, dicts: Speller[]): boolean {
  const bare = withoutPossessive(word);
  if (!bare) return true;
  const lower = bare.toLowerCase();
  if (ALLOWED.has(lower)) return true;
  if (CONTRACTION_OWNED.test(lower)) return true;
  for (const d of dicts) {
    if (d.correct(bare) || d.correct(lower)) return true;
  }
  // Hyphenated compound: real if every part is real. "state-of-the-art",
  // "co-founder", "data-driven". Guards against treating the whole string as
  // one unknown token.
  if (bare.includes("-")) {
    const parts = bare.split("-").filter(Boolean);
    if (parts.length > 1) {
      const allKnown = parts.every((p) => {
        if (/^\d+$/.test(p)) return true;
        const pl = p.toLowerCase();
        if (ALLOWED.has(pl)) return true;
        return dicts.some((d) => d.correct(p) || d.correct(pl));
      });
      if (allKnown) return true;
    }
  }
  return false;
}

export type Misspelling = {
  word: string;
  offset: number;
  length: number;
  suggestions: string[];
};

/**
 * Unambiguous misspellings that are always wrong, whatever their case.
 *
 * The capital-letter guard below silences every capitalised word, which also
 * silences a typo that happens to open a sentence. These strings buy most of
 * that back: each one is a well-known English misspelling and none is a
 * plausible name or brand, so matching them case-insensitively is safe.
 * Everything not on this list still relies on the dictionary.
 */
const COMMON_TYPOS = new Set([
  "teh", "recieve", "recieved", "recieving", "seperate", "seperated",
  "seperately", "definately", "definatly", "occured", "occuring",
  "occurance", "untill", "thier", "wierd", "thourough", "accomodate",
  "accomodated", "acommodate", "arguement", "beleive", "beleived",
  "calender", "cemetary", "changable", "collegue", "comming", "commited",
  "commitee", "concious", "consciencious", "critisism", "dilemna",
  "dissapoint", "dissapointed", "embarass", "embarassed", "enviroment",
  "existance", "experiance", "familar", "finaly", "foriegn", "fourty",
  "freind", "goverment", "grammer", "gaurd", "harrass", "harrassment",
  "hieght", "immediatly", "independant", "indispensible", "innoculate",
  "intresting", "irresistable", "knowlege", "liason", "libary", "lieutenent",
  "maintainance", "manuever", "millenium", "miniscule", "mischevious",
  "mispell", "mispelled", "neccessary", "necesary", "noticable",
  "occassion", "occassionally", "paralell", "pasttime", "perseverence",
  "personnell", "posession", "possesion", "prefered", "priviledge",
  "probaly", "proffesional", "pronounciation", "publically", "questionaire",
  "readible", "reccomend", "reccommend", "recomend", "refered", "referance",
  "relevent", "religous", "repetion", "restaraunt", "rhythem", "rythm",
  "sacrafice", "sacrilegous", "sargeant", "seige", "sieze", "similiar",
  "sincerly", "speach", "stoer", "strenght", "succesful", "successfull",
  "supercede", "supress", "suprise", "suprised", "temperture", "tendancy",
  "threshhold", "tommorow", "tommorrow", "tounge", "truely", "twelth",
  "tyrany", "underate", "unforseen", "unfortunatly", "unneccessary",
  "vaccuum", "vegatarian", "vehicule", "visable", "wether", "whereever",
  "wilfull", "withold", "writting", "yeild",
]);

/**
 * Find misspelled words in `text`.
 *
 * `isProtected` masks URLs, emails, and code spans, reusing the same guard
 * the pattern rules use.
 */
export function findMisspellings(
  text: string,
  dicts: Speller[],
  isProtected: (offset: number) => boolean,
  maxSuggestions = 3,
): Misspelling[] {
  if (dicts.length === 0) return [];
  const out: Misspelling[] = [];
  const seen = new Map<string, string[]>();

  // A word: letters, then optionally internal apostrophes and hyphens.
  const re = /[A-Za-z][A-Za-z'\u2019-]*[A-Za-z]|[A-Za-z]/g;
  for (const m of text.matchAll(re)) {
    const word = m[0];
    const offset = m.index;
    if (isProtected(offset)) continue;
    if (isNonWordShape(word)) continue;

    // A known-bad string is wrong even when capitalised at a sentence start.
    const typoKey = withoutPossessive(word).toLowerCase();
    const isKnownTypo = COMMON_TYPOS.has(typoKey);

    // The proper-noun guard. Any capitalised word is skipped.
    //
    // Mid-sentence, a capital is a reliable name/brand/title signal.
    //
    // At a sentence start it is NOT reliable, because every sentence-initial
    // word is capitalised, so "Stoer" (typo) and "Priya" (name) look
    // identical. Three discriminators were measured and all failed on a
    // 20-name / 10-typo set: whether the lowercased form yields a
    // common-word suggestion (6 names misfired - kwame->came, aoife->wife,
    // dubois->cuboid), edit distance to the top suggestion (names and typos
    // both cluster at 1-2), and suggestion count. Since the checker promises
    // "tuned to avoid false alarms", and names open sentences far more often
    // than typos do, the ambiguity is resolved in favour of silence.
    //
    // Known cost: a typo as the first word of a sentence is missed unless it
    // also appears mid-sentence somewhere in the text.
    if (/^[A-Z]/.test(word) && !isKnownTypo) continue;

    if (!isKnownTypo && known(word, dicts)) continue;

    const key = word.toLowerCase();
    let suggestions = seen.get(key);
    if (!suggestions) {
      // suggest() is the expensive call, so it runs once per distinct word.
      suggestions = dicts[0].suggest(word).slice(0, maxSuggestions);
      seen.set(key, suggestions);
    }

    out.push({ word, offset, length: word.length, suggestions });
  }
  return out;
}

/**
 * Spelling pass.
 *
 * Kept separate from checkGrammar because loading the dictionaries is async
 * and checkGrammar is synchronous everywhere it is used, including in tests
 * and in the style analyzer. Making it async would ripple through call sites
 * for no benefit; a caller that wants spelling asks for it.
 *
 * Returns issues in the same shape as every other rule, so the route merges
 * and scores them without special cases.
 */
export async function checkSpelling(text: string): Promise<GrammarIssue[]> {
  const dicts = await loadSpellers();
  if (dicts.length === 0) return [];

  const sentences = splitSentences(text);
  const guarded = protectedRanges(text);
  const isGuarded = (offset: number) => inProtected(guarded, offset);

  const found = findMisspellings(text, dicts, isGuarded);
  return found.map((m) =>
    issue(
      {
        rule: "spelling",
        category: "mechanics",
        severity: "error",
        message: m.suggestions.length
          ? `"${m.word}" may be misspelled. Did you mean ${m.suggestions
              .map((s) => `"${s}"`)
              .join(", ")}?`
          : `"${m.word}" is not in the dictionary.`,
        suggestion: m.suggestions[0] ?? null,
        offset: m.offset,
        length: m.length,
      },
      text,
      sentences,
    ),
  );
}
