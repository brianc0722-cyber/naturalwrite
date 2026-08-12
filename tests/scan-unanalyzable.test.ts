import { describe, expect, it } from "vitest";
import { detectAi } from "@/lib/ai-detector";
import { isLatinScript, latinLetterRatio, wordsOf } from "@/lib/tokenize";

/**
 * Guards the "honest refusal" path in POST /api/scan.
 *
 * Originally the route refused when detectAi() returned wordCount 0, which
 * happened for non-Latin script only because the tokenizer deleted every
 * non-ASCII letter. The tokenizer is now Unicode-aware, so word counts are
 * correct in any language and that condition no longer fires. The refusal is
 * therefore keyed on script instead: the detector's evidence is English
 * phrasing, so counting Ukrainian words correctly does not make the score
 * meaningful. These tests pin that decision.
 */
describe("script detection gates scoring", () => {
  it("refuses Cyrillic even though the words now tokenize", () => {
    const ukrainian =
      "Це моя стаття про життя в місті. Я люблю гуляти вулицями ввечері, коли світло стає мяким.";
    // The tokenizer sees the words...
    expect(wordsOf(ukrainian).length).toBeGreaterThan(10);
    // ...but the heuristics have no business scoring them.
    expect(isLatinScript(ukrainian)).toBe(false);
  });

  it("refuses Chinese", () => {
    expect(isLatinScript("这是一个测试。快速的棕色狐狸跳过懒狗。")).toBe(false);
  });

  it("refuses text with no letters at all", () => {
    expect(isLatinScript("12345 67890 ... !!! ---")).toBe(false);
    expect(latinLetterRatio("12345")).toBe(0);
  });

  it("accepts ordinary English", () => {
    const english =
      "The quick brown fox jumps over the lazy dog. It was a bright cold day in April.";
    expect(isLatinScript(english)).toBe(true);
    expect(detectAi(english, null).wordCount).toBeGreaterThan(10);
  });

  it("accepts accented Latin script and counts it correctly", () => {
    const spanish =
      "El rápido zorro marrón salta sobre el perro perezoso. Qué día tan bonito hace hoy.";
    expect(isLatinScript(spanish)).toBe(true);
    // 15 real words; the old ASCII tokenizer split the accented ones and
    // reported more than there are.
    expect(wordsOf(spanish).length).toBe(15);
  });

  it("accepts English that quotes a little foreign script", () => {
    const mixed =
      "She signed the letter with her name written in Chinese characters, 王小明, and then added a short postscript in English explaining the change.";
    expect(isLatinScript(mixed)).toBe(true);
  });
});

describe("Unicode tokenizer", () => {
  it("keeps accented letters inside one word", () => {
    expect(wordsOf("rápido")).toEqual(["rápido"]);
    expect(wordsOf("über")).toEqual(["über"]);
    expect(wordsOf("naïve café")).toEqual(["naïve", "café"]);
  });

  it("normalises curly apostrophes", () => {
    expect(wordsOf("don\u2019t")).toEqual(wordsOf("don't"));
  });

  it("keeps hyphenated words together", () => {
    expect(wordsOf("par-dessus")).toEqual(["par-dessus"]);
  });

  it("drops punctuation-only tokens", () => {
    expect(wordsOf("hello --- world ... !")).toEqual(["hello", "world"]);
  });

  it("counts Cyrillic words", () => {
    expect(wordsOf("Швидка руда лисиця").length).toBe(3);
  });
});
