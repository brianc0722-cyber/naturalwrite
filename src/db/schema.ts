import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Unit-tagged numbers.
 *
 * Every metric below is a ratio, and until now every one of them was a bare
 * `number`. Nothing stopped you comparing a per-word fraction to a
 * per-1,000-word rate: the two bugs this guards against (`formalityScore` and
 * `fpDiff`, found in separate reviews months apart) both typechecked cleanly
 * and both produced plausible-looking percentages. Silent wrong numbers.
 *
 * The tag exists only in the type system. `PerWord` IS a number at runtime —
 * these are zero-cost, the JSON shape is byte-identical, and profiles already
 * stored in the `profile` jsonb column keep working untouched. That last point
 * is why this is tagging rather than the field rename first proposed: the keys
 * are persisted, so renaming them would strand every existing row. A profile
 * written before this change and read after it would come back `undefined` on
 * the renamed fields and surface to users as "Partially matches your learned
 * style (NaN%)" — verified, not hypothetical.
 *
 * Arithmetic still works (`a - b`, `x * 1000`); only *assignment* across units
 * is an error, which is exactly the mistake both bugs made.
 */
declare const unitTag: unique symbol;
type Unit<Tag extends string> = number & { readonly [unitTag]?: Tag };

/** Occurrences per word. Multiply by 1,000 for a per-1k rate. */
export type PerWord = Unit<"perWord">;
/** Occurrences per sentence. */
export type PerSentence = Unit<"perSentence">;
/** Dimensionless 0..1 score. */
export type Ratio01 = Unit<"ratio01">;
/** A count of words. */
export type Words = Unit<"words">;

export type StyleProfile = {
  /** words per sentence */
  avgSentenceLength: number;
  /** characters per word (apostrophes stripped) */
  avgWordLength: number;
  /** unique words / total words */
  vocabularyRichness: Ratio01;
  contractionRate: PerWord;
  /** '?' per SENTENCE — not per word, unlike the densities below */
  questionRate: PerSentence;
  /** '!' per SENTENCE — not per word */
  exclamationRate: PerSentence;
  commaDensity: PerWord;
  semicolonDensity: PerWord;
  emDashDensity: PerWord;
  firstPersonRate: PerWord;
  passiveVoiceHint: PerSentence;
  /** 0 informal .. 1 formal */
  formalityScore: Ratio01;
  commonTransitions: string[];
  signaturePhrases: string[];
  preferredOpeners: string[];
  toneNotes: string[];
  /** total words across all analysed samples */
  sampleWordCount: Words;
  /** number of non-empty samples analysed */
  sampleCount: number;
};

export const writingSamples = pgTable("writing_samples", {
  id: serial("id").primaryKey(),
  /**
   * Unguessable id used in URLs. The serial `id` stays as the internal key,
   * but exposing it let anyone enumerate DELETE /api/samples/1..n and wipe
   * every row. Public routes address rows by this value instead.
   */
  publicId: uuid("public_id")
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 200 }).notNull().default("Untitled sample"),
  content: text("content").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  source: varchar("source", { length: 50 }).notNull().default("paste"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const styleProfiles = pgTable("style_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull().default("My writing style"),
  profile: jsonb("profile").$type<StyleProfile>().notNull(),
  summary: text("summary").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rewriteJobs = pgTable("rewrite_jobs", {
  id: serial("id").primaryKey(),
  originalText: text("original_text").notNull(),
  rewrittenText: text("rewritten_text").notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScanSignal = {
  label: string;
  points: number;
  detail: string;
};

export type ScanStyleMatch = {
  percent: number;
  note: string;
} | null;

export type AiOpinion = {
  model: string;
  score: number;
  verdict: string;
  reasoning: string;
  flags: string[];
} | null;

export const aiScans = pgTable("ai_scans", {
  id: serial("id").primaryKey(),
  /** Unguessable id used in URLs — see writingSamples.publicId. */
  publicId: uuid("public_id")
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()`),
  fileName: varchar("file_name", { length: 255 }).notNull().default("Pasted text"),
  wordCount: integer("word_count").notNull().default(0),
  score: integer("score").notNull(),
  verdict: varchar("verdict", { length: 60 }).notNull(),
  signals: jsonb("signals").$type<ScanSignal[]>().notNull(),
  styleMatch: jsonb("style_match").$type<ScanStyleMatch>(),
  aiOpinion: jsonb("ai_opinion").$type<AiOpinion>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GrammarIssueRow = {
  rule: string;
  category: "grammar" | "mechanics" | "style";
  severity: "error" | "warning" | "suggestion";
  message: string;
  suggestion: string | null;
  offset: number;
  length: number;
  excerpt: string;
  context: string;
};

export type GrammarStatsRow = {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgSentenceLength: number;
  longestSentence: number;
  readingSeconds: number;
};

export const grammarChecks = pgTable("grammar_checks", {
  id: serial("id").primaryKey(),
  /** Unguessable id used in URLs — see writingSamples.publicId. */
  publicId: uuid("public_id")
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()`),
  fileName: varchar("file_name", { length: 255 }).notNull().default("Pasted text"),
  wordCount: integer("word_count").notNull().default(0),
  score: integer("score").notNull(),
  verdict: varchar("verdict", { length: 60 }).notNull(),
  errorCount: integer("error_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  suggestionCount: integer("suggestion_count").notNull().default(0),
  /** Origin of the text: "paste", "upload", or "rewrite". */
  source: varchar("source", { length: 20 }).notNull().default("paste"),
  issues: jsonb("issues").$type<GrammarIssueRow[]>().notNull(),
  stats: jsonb("stats").$type<GrammarStatsRow>().notNull(),
  llmModel: varchar("llm_model", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
