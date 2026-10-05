import { charNgrams, contentWords, ngrams, tokenizeWords } from "./text";

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  const setA = new Set(a);
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  const setA = new Set(a);
  for (const x of setA) if (setB.has(x)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

export function cosine(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const x of a) fa.set(x, (fa.get(x) || 0) + 1);
  for (const x of b) fb.set(x, (fb.get(x) || 0) + 1);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of fa) {
    na += v * v;
    const u = fb.get(k);
    if (u) dot += v * u;
  }
  for (const v of fb.values()) nb += v * v;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function containment(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  const setA = new Set(a);
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / setA.size;
}

export type SimilarityBreakdown = {
  score: number;
  wordJaccard: number;
  shingle: number;
  charDice: number;
  cosine: number;
  containment: number;
};

export function compareTexts(a: string, b: string): SimilarityBreakdown {
  const wa = tokenizeWords(a);
  const wb = tokenizeWords(b);
  const ca = contentWords(a);
  const cb = contentWords(b);
  const wordJaccard = jaccard(ca, cb);
  const shingle = jaccard(ngrams(wa, 5), ngrams(wb, 5));
  const charDice = dice(charNgrams(a, 3), charNgrams(b, 3));
  const cos = cosine(ca, cb);
  const cont = containment(ngrams(wa, 4), ngrams(wb, 4));
  const score = clamp01(shingle * 0.38 + cont * 0.22 + wordJaccard * 0.16 + charDice * 0.12 + cos * 0.12);
  return { score, wordJaccard, shingle, charDice, cosine: cos, containment: cont };
}

export function matchType(score: number): "exact" | "near" | "paraphrase" | "none" {
  if (score >= 0.72) return "exact";
  if (score >= 0.48) return "near";
  if (score >= 0.32) return "paraphrase";
  return "none";
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function longestCommonWordRun(a: string, b: string): number {
  const wa = tokenizeWords(a);
  const wb = tokenizeWords(b);
  if (!wa.length || !wb.length) return 0;
  const map = new Map<string, number[]>();
  wb.forEach((w, i) => {
    const arr = map.get(w);
    if (arr) arr.push(i);
    else map.set(w, [i]);
  });
  let best = 0;
  for (let i = 0; i < wa.length; i++) {
    const hits = map.get(wa[i]);
    if (!hits) continue;
    for (const j of hits) {
      let k = 0;
      while (i + k < wa.length && j + k < wb.length && wa[i + k] === wb[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}
