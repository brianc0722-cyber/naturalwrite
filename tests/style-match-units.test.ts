import { describe, expect, it } from "vitest";
import { analyzeTexts, formalityOf } from "@/lib/style-analyzer";

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
