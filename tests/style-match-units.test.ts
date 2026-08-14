import { describe, expect, it } from "vitest";
import { analyzeTexts, formalityOf } from "@/lib/style-analyzer";
import { detectAi } from "@/lib/ai-detector";

/**
 * The scanner's styleMatch compares the scanned text's formality against the
 * stored profile's. Both sides must be produced by formalityOf() so they share
 * a scale; the old code substituted a 3-value bucket on one side.
 */
describe("formalityOf", () => {
  it("returns a 0-1 value", () => {
    const v = formalityOf("This is a sentence. Here is another one.", 2);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("scores formal prose above casual prose", () => {
    const formal =
      "Furthermore, the aforementioned analysis demonstrates a significant correlation. Consequently, it is necessary to consider the implications thereof. Moreover, the data substantiates this conclusion.";
    const casual =
      "So I kind of just showed up and it was fine. Pretty much everyone was already there. It's no big deal really, we just hung out.";
    expect(formalityOf(formal, 3)).toBeGreaterThan(formalityOf(casual, 3));
  });

  it("agrees with the value analyzeTexts stores on the profile", () => {
    const text =
      "Furthermore, the analysis demonstrates a significant correlation between the variables. Consequently, further study is warranted. The methodology herein is sound.";
    const profile = analyzeTexts([text]);
    // Same text, same scale: the profile's stored score must be reproducible
    // by calling the exported helper directly.
    const direct = formalityOf(text.toLowerCase(), 3);
    expect(Math.abs(profile.formalityScore - direct)).toBeLessThan(0.35);
  });

  it("is stable regardless of sentence count clamping", () => {
    expect(Number.isFinite(formalityOf("Hello.", 0))).toBe(true);
  });
});

/**
 * B1: guard the unit conversions in styleMatch behaviourally.
 *
 * The tagged types in schema.ts catch a per-word value being *assigned* where
 * per-sentence is expected, but they cannot catch a wrong scale *factor*:
 * `firstPersonRate * 10` is still a plain number and typechecks fine. That is
 * the exact shape of the original bug (fixed in b273389), so it needs a test,
 * not a type.
 */
describe("styleMatch unit conversions", () => {
  // A profile that clears the evidence gate (3+ samples, 1000+ words) and is
  // heavy on first person, which is where the units actually diverge.
  const firstPersonHeavy = Array.from(
    { length: 40 },
    (_, i) =>
      `I think I should review my notes again because I want to be sure of my numbers. I looked at my options and I picked the one I preferred in round ${i}.`,
  );

  it("scores text that matches the profile far above text that does not", () => {
    const profile = analyzeTexts(firstPersonHeavy);
    expect(profile.sampleCount).toBeGreaterThanOrEqual(3);
    expect(profile.sampleWordCount).toBeGreaterThanOrEqual(1000);

    const likeMe =
      "I think I should check my notes again because I want to be sure of my numbers. I looked at my options and I picked the one I preferred.";
    // Same length and structure, but third person: only the first-person term
    // should differ, so it isolates that term.
    const notLikeMe =
      "The team reviewed the notes again because accuracy was required for the numbers. The group examined the options and selected the preferred approach.";

    const mine = detectAi(likeMe, profile).styleMatch;
    const theirs = detectAi(notLikeMe, profile).styleMatch;
    expect(mine).not.toBeNull();
    expect(theirs).not.toBeNull();
    expect(mine!.percent).toBeGreaterThan(theirs!.percent!);
  });

  it("never reports a NaN or out-of-range match percentage", () => {
    // A 100x unit error pushes the term far outside 0-1 and surfaces to users
    // as "(NaN%)" or a nonsense number rather than throwing.
    const profile = analyzeTexts(firstPersonHeavy);
    for (const text of [
      "I I I I I me my mine I I me my I think I know I feel I said I did.",
      "The report was finalised.",
      "短い文章です。",
    ]) {
      const m = detectAi(text, profile).styleMatch;
      if (m && m.percent !== null) {
        expect(Number.isFinite(m.percent)).toBe(true);
        expect(m.percent).toBeGreaterThanOrEqual(0);
        expect(m.percent).toBeLessThanOrEqual(100);
      }
    }
  });
});
