import { describe, expect, it } from "vitest";
import { detectAi } from "@/lib/ai-detector";

/**
 * Guards the "honest refusal" path in POST /api/scan.
 *
 * The route returns 422 when detectAi() finds zero words. These tests pin the
 * condition that triggers it, so a future tokenizer change that makes non-Latin
 * text analyzable will fail here loudly rather than silently re-enabling the
 * fake-score behaviour.
 */
describe("unanalyzable text detection", () => {
  it("reports zero words for non-Latin script", () => {
    const ukrainian =
      "Це моя стаття про життя в місті. Я люблю гуляти вулицями ввечері, коли світло стає мяким.";
    expect(detectAi(ukrainian, null).wordCount).toBe(0);
  });

  it("reports zero words for Chinese", () => {
    expect(detectAi("这是一个测试。快速的棕色狐狸跳过懒狗。", null).wordCount).toBe(0);
  });

  it("still analyzes ordinary English", () => {
    const english =
      "The quick brown fox jumps over the lazy dog. It was a bright cold day in April.";
    expect(detectAi(english, null).wordCount).toBeGreaterThan(10);
  });

  it("still analyzes accented Latin script", () => {
    const spanish =
      "El rápido zorro marrón salta sobre el perro perezoso. Qué día tan bonito hace hoy.";
    expect(detectAi(spanish, null).wordCount).toBeGreaterThan(5);
  });
});
