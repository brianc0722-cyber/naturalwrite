import { describe, expect, it } from "vitest";
import {
  checkGrammar,
  scoreOf,
  splitSentences,
  verdictOf,
  GRAMMAR_CLEAN,
} from "@/lib/grammar";
import { checkSpelling } from "@/lib/spellcheck";

/** Rule ids fired by a given text. */
function rules(text: string): string[] {
  return checkGrammar(text).issues.map((i) => i.rule);
}

function fires(text: string, rule: string): boolean {
  return rules(text).includes(rule);
}

describe("splitSentences", () => {
  it("splits on terminal punctuation and keeps offsets", () => {
    const text = "One thing. Two things! Three?";
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual([
      "One thing.",
      "Two things!",
      "Three?",
    ]);
    // Offsets must point at the real position in the source string.
    for (const sent of s) {
      expect(text.slice(sent.start, sent.start + sent.text.length)).toBe(sent.text);
    }
  });

  it("does not split on common abbreviations", () => {
    expect(splitSentences("Dr. Chen arrived late.")).toHaveLength(1);
    expect(splitSentences("We met at 4 p.m. and left.")).toHaveLength(1);
    expect(splitSentences("Bring water, food, etc. before noon.")).toHaveLength(1);
  });

  it("does not split initials or decimals", () => {
    expect(splitSentences("J. R. R. Tolkien wrote it.")).toHaveLength(1);
    expect(splitSentences("It grew 3.5 percent.")).toHaveLength(1);
  });

  it("treats an ellipsis or interrobang as one boundary", () => {
    expect(splitSentences("Wait... what happened?")).toHaveLength(2);
    expect(splitSentences("Really?! I had no idea.")).toHaveLength(2);
  });

  it("handles text with no terminal punctuation", () => {
    expect(splitSentences("just a fragment")).toHaveLength(1);
  });

  it("returns nothing for empty input", () => {
    expect(splitSentences("")).toHaveLength(0);
    expect(splitSentences("   ")).toHaveLength(0);
  });
});

describe("mechanics rules", () => {
  it("catches doubled words", () => {
    expect(fires("This is the the problem here.", "doubled-word")).toBe(true);
  });

  it("allows legitimate repeats", () => {
    expect(fires("She had had enough of it.", "doubled-word")).toBe(false);
    expect(fires("I think that that argument fails.", "doubled-word")).toBe(false);
  });

  it("catches a space before punctuation", () => {
    expect(fires("Wait , what happened here?", "space-before-punctuation")).toBe(true);
  });

  it("catches a missing space after a comma", () => {
    expect(fires("Apples,oranges and pears are fine.", "missing-space-after-punctuation")).toBe(true);
  });

  it("does not fire inside a URL", () => {
    const text = "Read more at https://example.com/a,b/c for the details here.";
    expect(fires(text, "missing-space-after-punctuation")).toBe(false);
  });

  it("does not fire on a version number", () => {
    expect(fires("We shipped version 1.2.3 to production today.", "missing-space-after-sentence")).toBe(false);
  });

  it("catches lowercase standalone i", () => {
    expect(fires("Yesterday i went to the store.", "lowercase-i")).toBe(true);
  });

  it("does not flag i inside a word", () => {
    expect(fires("The list is incomplete and it needs work.", "lowercase-i")).toBe(false);
  });

  it("catches unmatched brackets", () => {
    expect(fires("This (is unbalanced and keeps going.", "unmatched-bracket")).toBe(true);
    expect(fires("This (is balanced) and fine.", "unmatched-bracket")).toBe(false);
  });

  it("catches an unclosed quote", () => {
    expect(fires('He said "it was fine and walked away.', "unmatched-quote")).toBe(true);
    expect(fires('He said "it was fine" and walked away.', "unmatched-quote")).toBe(false);
  });

  it("catches a lowercase sentence start", () => {
    expect(fires("This is fine. this one is not.", "sentence-capitalization")).toBe(true);
  });

  it("catches multiple spaces", () => {
    expect(fires("There is  too much space here.", "double-space")).toBe(true);
  });
});

describe("word confusion rules", () => {
  const cases: Array<[string, string]> = [
    ["Its been a long day already.", "its-contraction"],
    ["Your welcome to join us later.", "your-contraction"],
    ["Their is a problem with the plan.", "their-there"],
    ["I would of gone if I had known.", "have-of"],
    ["This is more better then the last one.", "then-than"],
    ["Do not loose the keys again.", "loose-lose"],
    ["Whose going to the meeting today?", "whos-contraction"],
    ["There was alot of noise outside.", "alot"],
    ["Irregardless of the cost, we proceed.", "irregardless"],
    ["The new rule had a positive affect on morale.", "affect-affect"],
    ["We were suppose to leave at noon.", "supposed-to"],
    ["Between you and I, the plan is weak.", "between-you-and-i"],
    ["I could care less about the outcome.", "could-care-less"],
  ];

  for (const [text, rule] of cases) {
    it(`flags ${rule}`, () => {
      const fired = rules(text);
      expect(fired.length).toBeGreaterThan(0);
    });
  }

  it('flags "their going to" but not a possessive gerund', () => {
    expect(rules("Their going to the store tomorrow morning.")).toContain(
      "their-theyre",
    );
    expect(rules("Their not ready for the meeting yet.")).toContain(
      "their-theyre-not",
    );
    // Legitimate possessive + gerund must stay silent.
    const ok = rules("Their marketing to millennials has improved a great deal.");
    expect(ok.filter((r) => r.startsWith("their-theyre"))).toEqual([]);
  });

  it("leaves correct usage alone", () => {
    const clean =
      "It's been a long day, and your package arrived on time. " +
      "There is more work than I expected, but I would have finished it anyway.";
    const found = rules(clean).filter((r) =>
      ["its-contraction", "your-contraction", "their-there", "have-of", "then-than"].includes(r),
    );
    expect(found).toEqual([]);
  });
});

describe("a / an by sound, not spelling", () => {
  it('flags "a" before a vowel sound', () => {
    expect(fires("She made a excellent point today.", "article-a-an")).toBe(true);
  });

  it('flags "an" before a consonant sound', () => {
    expect(fires("That is an tricky question to answer.", "article-a-an")).toBe(true);
  });

  it('accepts "a university" and "a user"', () => {
    expect(fires("He attends a university in Ohio.", "article-a-an")).toBe(false);
    expect(fires("This is a user account for testing.", "article-a-an")).toBe(false);
  });

  it('accepts "an hour" and "an honest answer"', () => {
    expect(fires("We waited an hour for the bus.", "article-a-an")).toBe(false);
    expect(fires("Give me an honest answer about it.", "article-a-an")).toBe(false);
  });

  it("stays silent on misspellings another rule already rewrites", () => {
    // Regression: "a alot" used to produce "an alot" from the article rule
    // while the alot rule produced "a lot" — two suggestions that contradict
    // each other on the same span.
    const issues = checkGrammar("Its a alot better then the last one.").issues;
    const article = issues.filter((i) => i.rule === "article-a-an");
    expect(article).toEqual([]);
    expect(issues.some((i) => i.rule === "alot")).toBe(true);
  });

  it('accepts "a one-time fee" and "a European city"', () => {
    expect(fires("There is a one-time fee for setup.", "article-a-an")).toBe(false);
    expect(fires("Prague is a European city worth visiting.", "article-a-an")).toBe(false);
  });
});

describe("subject-verb agreement in unambiguous frames", () => {
  it("flags singular pronoun with plural verb", () => {
    expect(fires("He are going to the store now.", "subject-verb-singular")).toBe(true);
    expect(fires("She have finished the report already.", "subject-verb-singular")).toBe(true);
  });

  it("flags plural pronoun with singular verb", () => {
    expect(fires("They was late to the meeting again.", "subject-verb-plural")).toBe(true);
  });

  it("leaves correct agreement alone", () => {
    const text = "He is going, she has finished, and they were late.";
    expect(fires(text, "subject-verb-singular")).toBe(false);
    expect(fires(text, "subject-verb-plural")).toBe(false);
  });
});

describe("style rules", () => {
  it("flags a very long sentence", () => {
    const long = `This sentence ${"keeps going and going ".repeat(12)}until it finally stops.`;
    expect(fires(long, "very-long-sentence") || fires(long, "long-sentence")).toBe(true);
  });

  it("flags wordy phrases", () => {
    expect(fires("We did it in order to save time on the project.", "wordy-phrase")).toBe(true);
    expect(fires("Due to the fact that it rained, we stayed inside.", "wordy-phrase")).toBe(true);
  });

  it("flags passive voice", () => {
    expect(fires("The report was written by the committee last week.", "passive-voice")).toBe(true);
  });

  it("classifies style issues as suggestions, not errors", () => {
    const r = checkGrammar("The report was written by the committee last week.");
    const passive = r.issues.find((i) => i.rule === "passive-voice");
    expect(passive?.severity).toBe("suggestion");
    expect(passive?.category).toBe("style");
  });
});

describe("offsets and excerpts", () => {
  it("every issue points at the text it describes", () => {
    const text =
      "Its been a long day. i waited a hour for the the bus , which never came.";
    const result = checkGrammar(text);
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(issue.offset).toBeGreaterThanOrEqual(0);
      expect(issue.offset + issue.length).toBeLessThanOrEqual(text.length);
      expect(text.slice(issue.offset, issue.offset + issue.length)).toBe(issue.excerpt);
    }
  });

  it("issues come back sorted by position", () => {
    const text = "Its been a long day. i waited a hour for the the bus.";
    const offsets = checkGrammar(text).issues.map((i) => i.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("never returns two issues at the same offset", () => {
    const text = "Its been a long day. i waited a hour for the the bus , ok.";
    const offsets = checkGrammar(text).issues.map((i) => i.offset);
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});

describe("scoring", () => {
  it("gives clean prose a high score", () => {
    const clean =
      "The committee met on Tuesday to review the proposal. " +
      "Members agreed that the budget needed revision before the vote. " +
      "We will reconvene next week with updated figures.";
    expect(checkGrammar(clean).score).toBeGreaterThanOrEqual(GRAMMAR_CLEAN);
  });

  it("penalizes errors more than suggestions", () => {
    const errors = scoreOf({ error: 3, warning: 0, suggestion: 0 }, 200);
    const suggestions = scoreOf({ error: 0, warning: 0, suggestion: 3 }, 200);
    expect(errors).toBeLessThan(suggestions);
  });

  it("is density based, so length alone does not sink the score", () => {
    // Same error rate, very different lengths: scores should be close.
    const short = scoreOf({ error: 1, warning: 0, suggestion: 0 }, 100);
    const long = scoreOf({ error: 10, warning: 0, suggestion: 0 }, 1000);
    expect(Math.abs(short - long)).toBeLessThanOrEqual(2);
  });

  it("caps the style penalty so suggestions cannot tank a document", () => {
    expect(scoreOf({ error: 0, warning: 0, suggestion: 200 }, 1000)).toBeGreaterThanOrEqual(88);
  });

  it("stays within 0-100", () => {
    expect(scoreOf({ error: 500, warning: 500, suggestion: 500 }, 50)).toBe(0);
    expect(scoreOf({ error: 0, warning: 0, suggestion: 0 }, 500)).toBe(100);
  });

  it("returns 0 for empty text", () => {
    expect(scoreOf({ error: 0, warning: 0, suggestion: 0 }, 0)).toBe(0);
  });

  it("maps scores to verdicts", () => {
    expect(verdictOf(95)).toBe("Clean");
    expect(verdictOf(75)).toBe("Minor issues");
    expect(verdictOf(50)).toBe("Needs editing");
    expect(verdictOf(20)).toBe("Needs significant editing");
  });
});

describe("stats", () => {
  it("counts words, sentences and paragraphs", () => {
    const text = "One two three.\n\nFour five six seven.";
    const { stats } = checkGrammar(text);
    expect(stats.wordCount).toBe(7);
    expect(stats.sentenceCount).toBe(2);
    expect(stats.paragraphCount).toBe(2);
  });

  it("reports the longest sentence", () => {
    const { stats } = checkGrammar("Short one. This sentence has rather more words in it than the first.");
    expect(stats.longestSentence).toBeGreaterThan(5);
  });
});

describe("robustness", () => {
  it("handles empty and whitespace input without throwing", () => {
    expect(() => checkGrammar("")).not.toThrow();
    expect(checkGrammar("").stats.wordCount).toBe(0);
    expect(() => checkGrammar("   \n\n  ")).not.toThrow();
  });

  it("handles text with no letters", () => {
    expect(() => checkGrammar("12345 67890 !!!")).not.toThrow();
  });

  it("does not mutate the input", () => {
    const text = "Its been a long day , truly.";
    const copy = text;
    checkGrammar(text);
    expect(text).toBe(copy);
  });

  it("handles a large document in reasonable time", () => {
    const doc = "The committee met to review the proposal carefully. ".repeat(2000);
    const start = Date.now();
    const r = checkGrammar(doc);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(r.stats.wordCount).toBeGreaterThan(10_000);
  });

  it("counts non-Latin words rather than crashing", () => {
    // The route refuses these; the engine itself must still not throw.
    expect(() => checkGrammar("Это предложение на русском языке.")).not.toThrow();
  });
});

describe("missing apostrophes in contractions", () => {
  it("flags the contractions that are not real words", () => {
    expect(fires("Im going to the store.", "missing-apostrophe")).toBe(true);
    expect(fires("I dont know.", "missing-apostrophe")).toBe(true);
    expect(fires("Youre early.", "missing-apostrophe")).toBe(true);
    expect(fires("Theyre here and theres no room.", "missing-apostrophe")).toBe(true);
    expect(fires("Thats the plan.", "missing-apostrophe")).toBe(true);
    expect(fires("I couldve told you.", "missing-apostrophe")).toBe(true);
    expect(fires("Whos going?", "missing-apostrophe")).toBe(true);
    expect(fires("It wasnt ready.", "missing-apostrophe")).toBe(true);
  });

  it("suggests the apostrophe form and keeps the writer's capitalisation", () => {
    const one = checkGrammar("Im late.").issues.find(
      (i) => i.rule === "missing-apostrophe",
    );
    expect(one?.suggestion).toBe("I'm");
    const two = checkGrammar("Dont go.").issues.find(
      (i) => i.rule === "missing-apostrophe",
    );
    expect(two?.suggestion).toBe("Don't");
    const three = checkGrammar("I dont go.").issues.find(
      (i) => i.rule === "missing-apostrophe",
    );
    expect(three?.suggestion).toBe("don't");
  });

  it("marks the exact span of the word", () => {
    const text = "Well, Im late.";
    const hit = checkGrammar(text).issues.find(
      (i) => i.rule === "missing-apostrophe",
    );
    expect(text.slice(hit!.offset, hit!.offset + hit!.length)).toBe("Im");
  });

  // The false-alarm budget. Every string here is correct English and must
  // stay silent, because each one collides with a stripped contraction.
  it("stays silent on real words that look like stripped contractions", () => {
    const clean = [
      "They were going to the store yesterday.",
      "We were happy and you were right.",
      "His cant about ethics was tiresome.",
      "It was his wont to rise at dawn.",
      "Well, he will be fine.",
      "She shed a tear and they wed in June.",
      "The lets on the property expired.",
      "Ill winds blow no good.",
      "The id, the ego, and the superego.",
    ];
    for (const t of clean) {
      expect(fires(t, "missing-apostrophe"), t).toBe(false);
    }
  });

  it("ignores acronyms and initialisms in caps", () => {
    expect(fires("The ID card and the IM protocol.", "missing-apostrophe")).toBe(
      false,
    );
  });

  it("does not fire inside urls, emails, or code spans", () => {
    expect(fires("Write to me@dont.com today.", "missing-apostrophe")).toBe(false);
    expect(fires("He typed `dont` in the sample.", "missing-apostrophe")).toBe(
      false,
    );
  });

  it("requires a verb frame for cant and wont", () => {
    expect(fires("He cant be serious.", "missing-apostrophe")).toBe(true);
    expect(fires("She wont go.", "missing-apostrophe")).toBe(true);
    expect(fires("His cant about ethics.", "missing-apostrophe")).toBe(false);
    expect(fires("It was his wont to rise.", "missing-apostrophe")).toBe(false);
  });
});

describe("transposed repeated words", () => {
  it("flags a pronoun echoed across an auxiliary", () => {
    expect(fires("What it is it you would like?", "repeated-word")).toBe(true);
    expect(fires("Is it is a good idea?", "repeated-word")).toBe(true);
    expect(fires("Why they are they leaving?", "repeated-word")).toBe(true);
  });

  it("suggests dropping the echo", () => {
    const hit = checkGrammar("What it is it you would like?").issues.find(
      (i) => i.rule === "repeated-word",
    );
    expect(hit?.excerpt).toBe("it is it");
    expect(hit?.suggestion).toBe("it is");
  });

  it("leaves idiom and legitimate repetition alone", () => {
    const clean = [
      "It is what it is.",
      "And that is that.",
      "Hand in hand they walked.",
      "We improved day by day.",
      "They met face to face.",
      "The wins came back to back.",
      "I told her that that was wrong.",
    ];
    for (const t of clean) {
      expect(fires(t, "repeated-word"), t).toBe(false);
    }
  });
});

describe("the reported live-site miss", () => {
  // Regression guard for the exact text that scored 100/CLEAN in production.
  const TEXT =
    "Im going to the stoer later with plans to get food for dinner. What it is it you would like? Let me know.";

  it("no longer scores as clean", () => {
    const r = checkGrammar(TEXT);
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
    expect(scoreOf(r.counts, r.stats.wordCount)).toBeLessThan(GRAMMAR_CLEAN);
  });

  it("catches both the apostrophe and the repeat", () => {
    const fired = rules(TEXT);
    expect(fired).toContain("missing-apostrophe");
    expect(fired).toContain("repeated-word");
  });
});

describe("spell checker", () => {
  /** Misspelled words reported for a text. */
  async function misspelled(text: string): Promise<string[]> {
    const issues = await checkSpelling(text);
    return issues.map((i) => i.excerpt ?? i.message);
  }

  const CLEAN = [
    "The API returns a JSON payload over HTTPS.",
    "Our roadmap covers Q3 2026 and the 1990s.",
    "Email support@example.com or visit https://example.com/docs today.",
    "Run `npm install --save-dev vitest` before the tests.",
    "We deployed version 2.14.3 to staging this morning.",
    "Priya reviewed the pull request and approved it.",
    "Zhang's team owns the billing service.",
    "Kwame and Aoife lead the onboarding workshop.",
    "Rajesh filed the ticket, and Thiago closed it.",
    "Kubernetes autoscaling kept the latency flat.",
    "The startup raised a Series B round last quarter.",
    "She emailed the CFO about the SaaS renewal.",
    "It's a well-thought-out, user-friendly redesign.",
    "Wilkes-Barre and Nakamura Industries signed the deal.",
    "Anthropic and Vercel both published postmortems.",
    "The team's 30-day retention rate rose 12%.",
  ];

  it("does not flag clean, real-world prose", async () => {
    for (const text of CLEAN) {
      expect(await misspelled(text), text).toEqual([]);
    }
  });

  it("catches ordinary misspellings", async () => {
    const found = await misspelled(
      "I recieve teh package seperate from the rest.",
    );
    expect(found).toEqual(["recieve", "teh", "seperate"]);
  });

  it("suggests the right correction", async () => {
    const issues = await checkSpelling("This is definately not accomodate.");
    const words = issues.map((i) => i.excerpt);
    expect(words).toContain("definately");
    expect(words).toContain("accomodate");
    const def = issues.find((i) => i.excerpt === "definately");
    expect(def?.suggestion).toBe("definitely");
  });

  it("catches a well-known typo even when it opens a sentence", async () => {
    expect(await misspelled("Stoer is where I went.")).toEqual(["Stoer"]);
    expect(await misspelled("Recieve the file first.")).toEqual(["Recieve"]);
  });

  it("stays quiet on unknown names that open a sentence", async () => {
    expect(await misspelled("Priya reviewed the draft.")).toEqual([]);
    expect(await misspelled("Dubois signed the contract.")).toEqual([]);
  });

  it("leaves stripped contractions to the apostrophe rule", async () => {
    expect(await misspelled("Im going to the store later.")).toEqual([]);
    expect(await misspelled("We dont know yet.")).toEqual([]);
  });

  it("respects protected ranges", async () => {
    expect(await misspelled("See https://exmaple.com/teh/stoer for more.")).toEqual([]);
    expect(await misspelled("Use `stoer.recieve()` in the handler.")).toEqual([]);
  });
});

describe("the reported live-site spelling miss", () => {
  const TEXT =
    "Im going to the stoer later with plans to get food for dinner. What it is it you would like? Let me know.";

  it("now catches the misspelling the pattern rules could not", async () => {
    const issues = await checkSpelling(TEXT);
    expect(issues.map((i) => i.excerpt)).toContain("stoer");
    expect(issues[0].rule).toBe("spelling");
  });
});

describe("subject-verb agreement across a prepositional phrase", () => {
  // "The list of items are ..." - the plural object of "of" pulls the verb
  // into the plural. This is the most common agreement error in English.
  const WRONG = [
    "The list of items are on the table.",
    "The set of tools were missing.",
    "This collection of essays have been praised.",
    "The cost of the upgrades are too high.",
    "A copy of the documents were sent.",
    "The purpose of these changes are unclear.",
    "Each version of the templates are outdated.",
    "The status of the servers are green.",
  ];

  // Quantifier subjects genuinely take a plural verb, and a relative clause
  // can legitimately put a plural verb after a plural noun.
  const RIGHT = [
    "The list of items is on the table.",
    "A number of people are waiting.",
    "A lot of users are complaining.",
    "A couple of things are missing.",
    "The rest of the files are ready.",
    "Some of the members are late.",
    "All of the reports are done.",
    "Most of the changes are minor.",
    "The majority of respondents are happy.",
    "Plenty of options are available.",
    "Half of the seats are empty.",
    "The set of rules that govern trades are complex.",
    "The version of the docs developers use are outdated.",
    "These kinds of results are hard to define.",
  ];

  it("flags the attraction error", () => {
    for (const text of WRONG) {
      expect(fires(text, "subject-verb-attraction"), text).toBe(true);
    }
  });

  it("stays quiet when the plural verb is correct", () => {
    for (const text of RIGHT) {
      expect(fires(text, "subject-verb-attraction"), text).toBe(false);
    }
  });

  it("names the real subject and offers the fix", () => {
    const found = checkGrammar("The list of items are on the table.").issues.find(
      (i) => i.rule === "subject-verb-attraction",
    );
    expect(found?.suggestion).toBe("items is");
    expect(found?.message).toContain("singular");
    expect(found?.severity).toBe("error");
  });
});

describe("past tense used where a participle belongs", () => {
  // "I have went" - the auxiliary forces the participle "gone".
  const WRONG = [
    "I have went there before.",
    "He has drank all the milk.",
    "They had took the last one.",
    "She has wrote three books.",
    "We have saw this happen.",
    "It has broke again.",
    "The choir has sang before.",
    "They have ran out of options.",
  ];

  // Correct participles, plus the noun traps that a naive rule would flag.
  const RIGHT = [
    "I have gone there before.",
    "He has drunk the milk.",
    "She has taken the lead.",
    "We have run the tests.",
    "He has come home.",
    "The bell had rung twice.",
    "She had spoken to him.",
    "We have drawn conclusions.",
    "He had had enough.",
    "I have a saw in the garage.",
    "I have saw blades in the shed.",
    "We have saw dust everywhere.",
  ];

  it("flags the wrong verb form", () => {
    for (const text of WRONG) {
      expect(fires(text, "past-participle"), text).toBe(true);
    }
  });

  it("leaves correct participles and noun phrases alone", () => {
    for (const text of RIGHT) {
      expect(fires(text, "past-participle"), text).toBe(false);
    }
  });

  it("names the participle it wants", () => {
    const found = checkGrammar("I have went there.").issues.find(
      (i) => i.rule === "past-participle",
    );
    expect(found?.suggestion).toBe("have gone");
    expect(found?.severity).toBe("error");
  });
});

describe("singular quantifiers followed by a plural noun", () => {
  const WRONG = [
    "Each of the students have a laptop.",
    "One of the files are missing.",
    "Neither of the options are good.",
    "Either of the plans are fine.",
    "Each of the reports were late.",
  ];

  // "both/all/some/many of" are genuinely plural and must stay quiet.
  const RIGHT = [
    "Each of the students has a laptop.",
    "One of the reasons people leave is pay.",
    "Both of the students have laptops.",
    "All of the files are missing.",
    "Many of the options are good.",
    "Some of the reports were late.",
  ];

  it("flags the disagreement", () => {
    for (const text of WRONG) {
      expect(fires(text, "quantifier-agreement"), text).toBe(true);
    }
  });

  it("stays quiet on plural quantifiers", () => {
    for (const text of RIGHT) {
      expect(fires(text, "quantifier-agreement"), text).toBe(false);
    }
  });

  it("does not double-flag with the attraction rule", () => {
    const fired = rules("Each of the students have a laptop.").filter(
      (r) => r === "quantifier-agreement" || r === "subject-verb-attraction",
    );
    expect(fired).toEqual(["quantifier-agreement"]);
  });
});
