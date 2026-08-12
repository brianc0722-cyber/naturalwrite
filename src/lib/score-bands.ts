/**
 * Score band boundaries for the AI scanner.
 *
 * Kept in their own module rather than in ai-detector.ts because the scanner
 * UI is a client component: importing them from the detector would pull the
 * whole detection engine (and the style analyzer it depends on) into the
 * browser bundle for the sake of two numbers.
 *
 * Below SCORE_LOW: few AI-style patterns. At or above SCORE_HIGH: many.
 * In between is genuinely ambiguous and is always presented as such.
 */
export const SCORE_LOW = 35;
export const SCORE_HIGH = 65;
