import { describe, expect, it } from "vitest";
import { analyzeTexts, rewriteToStyle } from "@/lib/style-analyzer";
import type { StyleProfile } from "@/db/schema";

const FORMAL: StyleProfile = {
  avgSentenceLength: 18, avgWordLength: 5, vocabularyRichness: 0.6,
  contractionRate: 0.005, questionRate: 0, exclamationRate: 0,
  commaDensity: 0.05, semicolonDensity: 0.01, emDashDensity: 0,
  firstPersonRate: 0.01, passiveVoiceHint: 0.1, formalityScore: 0.8,
  commonTransitions: [], signaturePhrases: [], preferredOpeners: [],
  toneNotes: [], sampleWordCount: 2000, sampleCount: 5,
};

const CASUAL: StyleProfile = { ...FORMAL, formalityScore: 0.2, contractionRate: 0.05 };

describe("rewriteToStyle — structure preservation (fix 1.6)", () => {
  it("keeps paragraph breaks", () => {
    const input = "First paragraph here.\n\nSecond paragraph here.";
    expect(rewriteToStyle(input, FORMAL).rewritten).toContain("\n\n");
  });

  it("keeps list markers and one bullet per line", () => {
    const input = "Intro line goes here.\n\n- bullet one is here\n- bullet two is here";
    const out = rewriteToStyle(input, FORMAL).rewritten;
    expect(out.split("\n").filter((l) => l.trim().startsWith("-"))).toHaveLength(2);
  });

  it("returns guidance for empty input", () => {
    const { rewritten, notes } = rewriteToStyle("   ", FORMAL);
    expect(rewritten).toBe("");
    expect(notes.join(" ")).toMatch(/add some text/i);
  });

  it("does not duplicate notes across blocks", () => {
    const { notes } = rewriteToStyle("One para.\n\nTwo para.\n\nThree para.", FORMAL);
    expect(new Set(notes).size).toBe(notes.length);
  });
});

describe("rewriteToStyle — sentence splitting safety", () => {
  it("does not split URLs into sentences", () => {
    expect(rewriteToStyle("Visit example.com for details.", FORMAL).rewritten)
      .toContain("example.com");
  });

  it("does not split decimals", () => {
    expect(rewriteToStyle("The reading was 3.5 units and stable.", FORMAL).rewritten)
      .toContain("3.5");
  });

  it("does not capitalize after common abbreviations", () => {
    const out = rewriteToStyle("Dr. Smith confirmed it. See fig. 2 for the chart.", FORMAL).rewritten;
    expect(out).toContain("Dr. Smith");
    expect(out).toContain("fig. 2");
  });

  it("never emits sentence fragments when shortening", () => {
    // Regression: produced "I bought salt. Pepper. Some bread."
    const input = "I bought salt and pepper and some bread and then I drove home in the rain.";
    const out = rewriteToStyle(input, { ...FORMAL, avgSentenceLength: 5 }).rewritten;
    expect(out).not.toMatch(/\bPepper\.\s/);
    for (const sentence of out.split(/(?<=[.!?])\s+/).filter(Boolean)) {
      expect(sentence.trim().split(/\s+/).length).toBeGreaterThan(2);
    }
  });

  it("keeps the pronoun 'I' capitalized when joining sentences", () => {
    const out = rewriteToStyle(
      "Please show the team. I cannot help it.",
      { ...FORMAL, avgSentenceLength: 40 },
    ).rewritten;
    expect(out).not.toMatch(/\bi\b/);
  });
});

describe("rewriteToStyle — word swaps must not corrupt meaning", () => {
  it("does not turn 'the end result' into 'the conclude result'", () => {
    const out = rewriteToStyle("The end result was good.", FORMAL).rewritten;
    expect(out).not.toMatch(/conclude result/);
  });

  it("does not mangle 'show' in 'TV show'", () => {
    expect(rewriteToStyle("Please show the TV show to the team.", FORMAL).rewritten)
      .toContain("TV show");
  });

  it("applies casual swaps when the profile is informal", () => {
    const out = rewriteToStyle("I utilize this approximately daily.", CASUAL).rewritten;
    expect(out).toMatch(/\buse\b/);
    expect(out).not.toMatch(/utilize/);
  });

  it("is idempotent enough to be stable on a second pass", () => {
    const once = rewriteToStyle("The committee reviewed the proposal.", FORMAL).rewritten;
    expect(rewriteToStyle(once, FORMAL).rewritten).toBe(once);
  });
});

describe("analyzeTexts", () => {
  it("ignores blank samples in the count", () => {
    const profile = analyzeTexts(["   ", "", "Real sample text with several words in it."]);
    expect(profile.sampleCount).toBeLessThanOrEqual(1);
  });

  it("returns a usable zero profile for no input", () => {
    const profile = analyzeTexts([]);
    expect(profile.sampleCount).toBe(0);
    expect(Number.isFinite(profile.avgSentenceLength)).toBe(true);
  });

  it("scores formal prose as more formal than casual prose", () => {
    const formal = analyzeTexts([
      "The committee reviewed the proposal in detail. The findings were presented to the board.",
      "Attendance figures exceeded projections. Further analysis will be provided in the report.",
    ]);
    const casual = analyzeTexts([
      "I can't believe it worked! That's wild, honestly.",
      "So yeah, we just kinda winged it and it turned out fine.",
    ]);
    expect(formal.formalityScore).toBeGreaterThan(casual.formalityScore);
  });
});

/**
 * B2: uploading samples must never make the rewriter do LESS lexical work than
 * it does for a user with no samples at all.
 *
 * The balanced formality band (0.45–0.62) used to be a no-op that only pushed
 * a note. Because formalityOf() centres on 0.5, that band is where ordinary
 * prose lands — so the regression hit the common case, not an edge case.
 */
const BALANCED: StyleProfile = { ...FORMAL, formalityScore: 0.5 };

describe("rewriteToStyle — balanced register is not a no-op (B2)", () => {
  const BLOATED =
    "We must utilize every resource prior to commencing, due to the fact that it is important to note that time is short.";

  it("de-bloats text for a balanced profile", () => {
    const out = rewriteToStyle(BLOATED, BALANCED).rewritten;
    expect(out).toMatch(/\buse\b/);
    expect(out).toMatch(/\bbefore\b/);
    expect(out).toMatch(/\bbecause\b/);
    expect(out).not.toMatch(/utilize|prior to|due to the fact that/);
  });

  it("does at least as much lexical work as having no profile at all", () => {
    // The core promise: more information about the user cannot mean less help.
    const balanced = rewriteToStyle(BLOATED, BALANCED).rewritten;
    const noProfile = rewriteToStyle(BLOATED, null).rewritten;
    expect(balanced.length).toBeLessThanOrEqual(noProfile.length);
  });

  it("does not push a balanced profile toward the casual pole", () => {
    // Register-carrying swaps must not fire here — that is what keeps this
    // branch "balanced" rather than a quiet casual shift. Caught a real bug:
    // the first cut reused FORMAL_TO_CASUAL.slice(0, 12), which contains
    // "however" -> "but" and rewrote formal-but-correct prose.
    for (const [input, word] of [
      ["However, the result was clear.", /However/i],
      ["Therefore, we proceeded.", /Therefore/i],
      ["The value was subsequently revised.", /subsequently/i],
      ["It took approximately 40 minutes.", /approximately/i],
    ] as Array<[string, RegExp]>) {
      expect(rewriteToStyle(input, BALANCED).rewritten).toMatch(word);
    }
  });

  it("de-bloats without shifting register for the no-profile path too", () => {
    // Both paths share NEUTRAL_DEBLOAT, so neither may carry register.
    const out = rewriteToStyle("However, we utilize it prior to launch.", null).rewritten;
    expect(out).toMatch(/However/i);
    expect(out).toMatch(/\buse\b/);
    expect(out).toMatch(/\bbefore\b/);
  });

  it("still reports a balanced register in its note", () => {
    const { notes } = rewriteToStyle(BLOATED, BALANCED);
    expect(notes.join(" ")).toMatch(/balanced register/i);
  });

  it("reports the honest note when there was no bloat to trim", () => {
    const { notes } = rewriteToStyle("The cat sat on the mat.", BALANCED);
    expect(notes.join(" ")).toContain("Kept a balanced register matching your samples");
  });

  it("leaves the casual and formal branches unchanged", () => {
    expect(rewriteToStyle("I utilize this daily.", CASUAL).rewritten).toMatch(/\buse\b/);
    const formalOut = rewriteToStyle("However, we use it.", FORMAL).rewritten;
    expect(formalOut).not.toMatch(/\butilize\b.*\butilize\b/);
  });
});
