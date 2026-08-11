import { describe, expect, it } from "vitest";
import { detectAi, DETECTOR_DISCLAIMER } from "@/lib/ai-detector";
import type { StyleProfile } from "@/db/schema";

/**
 * Regression tests seeded from the code-review probes.
 * The headline bug: phrase matching used `lower.includes(p)`, so ordinary
 * words containing an AI phrase as a substring scored as AI hits.
 */

const HUMAN_WHISKEY = `
Robustness was never the point of the old distilleries. The elevated
warehouses along the river held barrels that intricately darkened over
decades, and the coopers who meticulously rebuilt them underscored a simple
truth: the interplay between oak and time cannot be rushed. My grandfather
kept a ledger. He wrote down the weather, the barrel numbers, and almost
nothing else. When I read it now I can smell the rickhouse — damp wood, spilled
mash, and the sharp bite of an autumn morning in Kentucky. He never once used
the word craft.
`.trim();

const GPT_ESSAY = `
In today's rapidly evolving digital landscape, it is important to note that
technology plays a pivotal role in shaping our collective future. Moreover,
the multifaceted nature of innovation underscores the need for a comprehensive
approach. Furthermore, organizations must navigate the complex tapestry of
modern challenges. In conclusion, by leveraging cutting-edge solutions and
fostering meaningful collaboration, we can unlock unprecedented opportunities
and embark on a transformative journey toward sustainable growth.
`.trim();

describe("detectAi — substring false positives (fix 1.1)", () => {
  it("does not count 'robustness', 'elevated', 'meticulously' as AI phrases", () => {
    const result = detectAi(HUMAN_WHISKEY, null);
    const phraseSignal = result.signals.find((s) =>
      /phrase/i.test(s.label),
    );
    // Before the fix this passage scored 6 phantom hits and ~50 overall.
    if (phraseSignal) {
      expect(phraseSignal.points).toBeLessThanOrEqual(8);
    }
    expect(result.score).toBeLessThan(45);
  });

  it("still catches genuine stock AI phrasing", () => {
    const result = detectAi(GPT_ESSAY, null);
    expect(result.score).toBeGreaterThan(55);
  });

  it("separates human from AI samples", () => {
    expect(detectAi(GPT_ESSAY, null).score).toBeGreaterThan(
      detectAi(HUMAN_WHISKEY, null).score,
    );
  });
});

describe("detectAi — output contract", () => {
  it("clamps the score to 0..100", () => {
    for (const text of [HUMAN_WHISKEY, GPT_ESSAY, "short. text. here. okay."]) {
      const { score } = detectAi(text, null);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("reports low confidence on short input", () => {
    expect(detectAi("This is a very short sample of text.", null).confidence)
      .toBe("low");
  });

  it("never phrases the verdict as proof of authorship", () => {
    for (const text of [HUMAN_WHISKEY, GPT_ESSAY]) {
      const { verdict } = detectAi(text, null);
      expect(verdict).not.toMatch(/definitely|certainly|proven|plagiari/i);
    }
  });

  it("ships a disclaimer for the UI to render", () => {
    expect(DETECTOR_DISCLAIMER).toMatch(/not proof/i);
  });
});

describe("detectAi — styleMatch evidence gate (fix 1.4)", () => {
  const thinProfile: StyleProfile = {
    avgSentenceLength: 18, avgWordLength: 5, vocabularyRichness: 0.6,
    contractionRate: 0.01, questionRate: 0, exclamationRate: 0,
    commaDensity: 0.05, semicolonDensity: 0, emDashDensity: 0,
    firstPersonRate: 0.01, passiveVoiceHint: 0.1, formalityScore: 0.7,
    commonTransitions: [], signaturePhrases: [], preferredOpeners: [],
    toneNotes: [], sampleWordCount: 50, sampleCount: 1,
  };

  it("suppresses styleMatch when the profile has too little evidence", () => {
    expect(detectAi(GPT_ESSAY, thinProfile).styleMatch).toBeNull();
  });

  it("produces styleMatch once there is enough evidence", () => {
    const rich = { ...thinProfile, sampleCount: 5, sampleWordCount: 4000 };
    const match = detectAi(GPT_ESSAY, rich).styleMatch;
    expect(match).not.toBeNull();
    expect(match!.percent).toBeGreaterThanOrEqual(0);
    expect(match!.percent).toBeLessThanOrEqual(100);
  });
});
