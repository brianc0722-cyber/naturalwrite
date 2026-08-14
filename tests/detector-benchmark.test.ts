import { describe, expect, it } from "vitest";
import { detectAi } from "@/lib/ai-detector";
import { SCORE_HIGH, SCORE_LOW } from "@/lib/score-bands";

/**
 * Behavioural benchmark for the AI detector.
 *
 * WHY THIS EXISTS
 * ---------------
 * The detector is a bag of hand-tuned heuristics. Every individual signal
 * looks defensible in isolation, so it is easy to "improve" one of them and
 * silently wreck the thing that actually matters: the SEPARATION between
 * human and AI prose, and the promise that formal human writing is not
 * accused of being machine-generated.
 *
 * Unit tests on single samples cannot see that. This file holds a fixed
 * corpus and asserts on the DISTRIBUTION, so a tuning change that raises one
 * sample by helping and another by accident shows up as a failure.
 *
 * The corpus deliberately includes the hard cases in both directions:
 *   - formal, marker-dense HUMAN prose (Federalist, academic history, a
 *     corporate memo) which naive detectors flag as AI
 *   - lightly edited AI, which no honest detector can catch
 * Those two groups are why the thresholds below have margin rather than
 * hugging the recorded numbers.
 *
 * RECORDED BASELINE (commit b9a6100, before any scoring changes):
 *
 *   HUMAN  51  Federalist-style prose
 *   HUMAN  60  Academic history          <- highest human, 5 below SCORE_HIGH
 *   HUMAN  30  Grad school personal statement
 *   HUMAN  54  Corporate memo (human)
 *   HUMAN  26  Hemingway-ish fiction
 *   HUMAN   7  Casual blog
 *   HUMAN  22  Lab report
 *   AI     73  Classic GPT essay
 *   AI     44  GPT listicle
 *   AI     63  GPT product copy
 *   AI     35  Lightly edited AI         <- expected miss, not asserted on
 *
 *   human mean 35.7 | ai mean 53.8 | separation 18.1
 *
 * IF THIS FILE FAILS: do not edit the numbers to make it pass. The assertions
 * encode user-visible promises. A change that breaks them is a regression in
 * the product even when it looks like an improvement in the code.
 */

const HUMAN: Record<string, string> = {
 "Federalist-style prose": `Ambition must be made to counteract ambition. The interest of the man must be connected with the constitutional rights of the place. It may be a reflection on human nature that such devices should be necessary to control the abuses of government. But what is government itself but the greatest of all reflections on human nature? If men were angels, no government would be necessary.`,
 "Academic history": `The Reformation did not arrive in Basel as a single event. Printers, students, and guild members argued over indulgences for years before the council acted. Moreover, the city's bishops retained property rights long after 1529. Historians have therefore debated whether the term "civic reformation" is useful. Ultimately the archival record is fragmentary, and any conclusion must remain provisional.`,
 "Grad school personal statement": `My interest in epidemiology began in a county health office, not a lecture hall. I spent two summers entering case reports by hand and noticed that the same three addresses kept reappearing. Nobody had time to ask why. That question followed me through my undergraduate coursework, and it is the reason I am applying to this program.`,
 "Corporate memo (human)": `Following the Q3 review, the leadership team has decided to consolidate the two reporting lines. Additionally, headcount requests will pause until January. Managers should communicate this to their teams before Friday. Please direct questions regarding severance or transfers to HR.`,
 "Hemingway-ish fiction": `The rain came at four. He sat on the porch with the dog and watched the water pool in the ruts. Nobody came down the road. At six he went in and made eggs and did not turn on the light. The dog slept by the door.`,
 "Casual blog": `honestly i just wrote this in like five minutes on my phone. it's not polished. my sister said the same thing last week when we were arguing about the dishwasher, which, fine, she was right.`,
 "Lab report": `Samples were incubated at 37 degrees Celsius for 24 hours. Absorbance was measured at 600 nm using a spectrophotometer. Each condition was run in triplicate. The mean optical density of the treated group was 0.42 compared with 0.61 in the control, a difference that was statistically significant at p < 0.05.`,
};
const AI: Record<string, string> = {
 "Classic GPT essay": `In today's fast-paced digital world, it is important to note that technology plays a crucial role in shaping the modern workplace. Furthermore, organizations must navigate the complexities of an ever-evolving landscape. Moreover, a holistic approach can unlock the potential of teams. In conclusion, embracing transformative change paves the way for success.`,
 "GPT listicle": `Here are three ways to improve your morning routine. First, wake up at a consistent time each day to regulate your circadian rhythm. Second, hydrate immediately after waking, as your body loses water overnight. Third, avoid checking your phone for the first thirty minutes. By implementing these strategies, you can set yourself up for a productive day.`,
 "GPT product copy": `Our platform delivers a seamless integration experience designed to elevate your workflow. With cutting-edge automation and a robust feature set, teams can focus on what matters most. Whether you are a small business or a global enterprise, the solution scales with your needs.`,
 "Lightly edited AI": `Remote work changed how teams build trust. When people cannot read a room, they rely on written signals instead, and those signals are easy to misread. Managers who over-communicate tend to do better here. The tradeoff is meeting fatigue, which is its own problem.`,
};

function scoresFor(corpus: Record<string, string>): Array<[string, number]> {
  return Object.entries(corpus).map(([label, text]) => [
    label,
    detectAi(text, null).score,
  ]);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("AI detector benchmark", () => {
  const humanScores = scoresFor(HUMAN);
  const aiScores = scoresFor(AI);

  it("never flags human writing as 'Many AI-style patterns'", () => {
    // The false-positive promise. Formal human prose is the whole risk here:
    // an academic or a lawyer must not be told their own writing is AI.
    for (const [label, score] of humanScores) {
      expect(
        score,
        `human sample "${label}" scored ${score}, at or above SCORE_HIGH (${SCORE_HIGH})`,
      ).toBeLessThan(SCORE_HIGH);
    }
  });

  it("keeps a real gap between AI and human means", () => {
    // Separation, not absolute scores. Shifting every score up or down is
    // harmless; collapsing the distance between the groups is not.
    const separation = mean(aiScores.map((r) => r[1])) - mean(humanScores.map((r) => r[1]));
    expect(separation).toBeGreaterThanOrEqual(15);
  });

  it("still catches unedited machine prose", () => {
    // The sensitivity floor. Without this, a change could pass the
    // false-positive test simply by scoring everything low.
    const classic = aiScores.find(([label]) => label === "Classic GPT essay");
    expect(classic).toBeDefined();
    expect(classic![1]).toBeGreaterThanOrEqual(SCORE_HIGH);
  });

  it("leaves plainly casual writing alone", () => {
    const casual = humanScores.find(([label]) => label === "Casual blog");
    expect(casual).toBeDefined();
    expect(casual![1]).toBeLessThan(SCORE_LOW);
  });
});
