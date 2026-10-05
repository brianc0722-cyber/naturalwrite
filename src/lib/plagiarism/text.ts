export const STOPWORDS = new Set(
  `a an the and or but if while of for to in on at from by with as is are was were be been being
   this that these those it its they them their you your we our i me my he she his her not no nor
   so than then too very can will just about into over after before between also such only own same
   than too very s t don should now d ll m o re ve y ain aren couldn didn doesn hadn hasn haven
   isn ma mightn mustn needn shan shouldn wasn weren won wouldn have has had do does did`.split(/\s+/),
);

export function normalize(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeWords(text: string): string[] {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function contentWords(text: string): string[] {
  return tokenizeWords(text).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function splitSentences(text: string): string[] {
  const cleaned = normalize(text);
  if (!cleaned) return [];
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function wordCount(text: string): number {
  return tokenizeWords(text).length;
}

export function ngrams(words: string[], n: number): string[] {
  if (words.length < n) return words.length ? [words.join(" ")] : [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

export function charNgrams(text: string, n = 3): string[] {
  const s = tokenizeWords(text).join(" ");
  if (s.length < n) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i <= s.length - n; i++) out.push(s.slice(i, i + n));
  return out;
}

export function distinctivePhrases(text: string, limit = 8): string[] {
  const sentences = splitSentences(text);
  const scored = sentences
    .map((sentence) => {
      const words = tokenizeWords(sentence);
      const content = contentWords(sentence);
      if (words.length < 6 || words.length > 50) return null;
      const rare = content.filter((w) => w.length >= 6).length;
      const score = rare * 2 + content.length + Math.min(words.length, 24) * 0.15;
      return { score, sentence };
    })
    .filter((x): x is { score: number; sentence: string } => x !== null)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of scored) {
    const key = tokenizeWords(item.sentence).slice(0, 8).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.sentence);
    if (out.length >= limit) break;
  }
  return out;
}

export function queryFromSentence(sentence: string): string {
  const words = tokenizeWords(sentence).slice(0, 12);
  return words.join(" ");
}

/** Exact 8–10 word windows used as quoted web queries — catches copied news/blog text. */
export function exactPhraseQueries(text: string, limit = 6): string[] {
  const words = tokenizeWords(text);
  const phrases: string[] = [];
  const window = words.length >= 40 ? 10 : 8;

  const offsets = [
    0,
    Math.max(0, Math.floor(words.length * 0.2)),
    Math.max(0, Math.floor(words.length * 0.45)),
    Math.max(0, Math.floor(words.length * 0.7)),
  ];
  for (const start of offsets) {
    if (start + window <= words.length) {
      phrases.push(words.slice(start, start + window).join(" "));
    }
  }

  for (const sentence of distinctivePhrases(text, 4)) {
    const w = tokenizeWords(sentence);
    if (w.length >= 8) phrases.push(w.slice(0, window).join(" "));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of phrases) {
    if (p.split(" ").length < 7) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export function gramContainment(input: string, corpus: string, n = 5): number {
  const grams = [...new Set(ngrams(tokenizeWords(input), n))];
  if (!grams.length) return 0;
  const pool = new Set(ngrams(tokenizeWords(corpus), n));
  let hits = 0;
  for (const g of grams) if (pool.has(g)) hits++;
  return hits / grams.length;
}
