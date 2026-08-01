import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  varchar,
} from "drizzle-orm/pg-core";

export type StyleProfile = {
  avgSentenceLength: number;
  avgWordLength: number;
  vocabularyRichness: number;
  contractionRate: number;
  questionRate: number;
  exclamationRate: number;
  commaDensity: number;
  semicolonDensity: number;
  emDashDensity: number;
  firstPersonRate: number;
  passiveVoiceHint: number;
  formalityScore: number; // 0 informal .. 1 formal
  commonTransitions: string[];
  signaturePhrases: string[];
  preferredOpeners: string[];
  toneNotes: string[];
  sampleWordCount: number;
  sampleCount: number;
};

export const writingSamples = pgTable("writing_samples", {
  id: serial("id").primaryKey(),
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
