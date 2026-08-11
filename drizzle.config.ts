import type { Config } from "drizzle-kit";

/**
 * Reads DATABASE_URL from the environment. The previous drizzle.config.json
 * hardcoded postgresql://postgres:postgres@127.0.0.1:5432/app_db, which meant
 * `drizzle-kit push` silently targeted a local database even when
 * DATABASE_URL pointed at production (or vice versa).
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in before running drizzle-kit.",
  );
}

export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
} satisfies Config;
