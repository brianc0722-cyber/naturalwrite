import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Creates the database tables automatically the first time the app talks to
 * the database. Idempotent (CREATE TABLE IF NOT EXISTS), so it is safe to run
 * on every server start. This means a brand-new database works with zero
 * manual SQL.
 */
let ready: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS writing_samples (
          id SERIAL PRIMARY KEY,
          title VARCHAR(200) NOT NULL DEFAULT 'Untitled sample',
          content TEXT NOT NULL,
          word_count INTEGER NOT NULL DEFAULT 0,
          source VARCHAR(50) NOT NULL DEFAULT 'paste',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS style_profiles (
          id SERIAL PRIMARY KEY,
          name VARCHAR(120) NOT NULL DEFAULT 'My writing style',
          profile JSONB NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS rewrite_jobs (
          id SERIAL PRIMARY KEY,
          original_text TEXT NOT NULL,
          rewritten_text TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => {
      ready = null; // allow retry on the next request
      console.error("ensureSchema failed", err);
      throw err;
    });
  }
  return ready;
}
