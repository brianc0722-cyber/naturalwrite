/**
 * Shared tokenizer for the style analyzer and the AI detector.
 *
 * Both modules previously carried a verbatim copy of an ASCII-only tokenizer:
 *
 *   text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/)
 *
 * `[^a-z0-9'\s-]` deletes every non-ASCII letter, which failed two different
 * ways. Accented Latin *over-counted*, because "rápido" lost its accent and
 * split into "r" + "pido", inflating word counts and skewing every derived
 * metric for Spanish, French, German and Portuguese. Non-Latin scripts
 * collapsed to zero tokens.
 *
 * The class below is Unicode-aware, so word counts are now correct for any
 * language. That is deliberately NOT the same thing as being able to *judge*
 * any language: the detector's evidence is English AI-style phrasing,
 * transition words and contraction patterns. Counting Ukrainian words
 * correctly does not make an English-trained heuristic meaningful on
 * Ukrainian. Use `isLatinScript()` to decide whether scoring is meaningful;
 * the scan route refuses rather than dressing up its neutral prior as a
 * verdict.
 */

/** Curly apostrophes normalised so "don't" and "don’t" tokenize alike. */
const APOSTROPHES = /[\u2019\u02BC\u02B9\u0027]/g;

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * Share of letters that are Latin script, ignoring digits, spaces and
 * punctuation. Returns 0 for text with no letters at all.
 */
export function latinLetterRatio(text: string): number {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return 0;
  const latin = text.match(/\p{Script=Latin}/gu);
  return (latin?.length ?? 0) / letters.length;
}

/**
 * Whether the heuristics can say anything meaningful about this text.
 *
 * A threshold rather than a strict test: an English document quoting a line
 * of Greek or a Chinese name is still an English document. Below 60% Latin
 * letters the English-specific signals are measuring almost nothing.
 */
export function isLatinScript(text: string): boolean {
  return latinLetterRatio(text) >= 0.6;
}
