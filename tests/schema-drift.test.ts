import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/lib/bootstrap.ts` hand-maintains raw DDL that mirrors
 * `src/db/schema.ts`, and `./drizzle` holds generated migrations. Three
 * copies of one schema will drift. These tests fail loudly when they do.
 */

const root = join(__dirname, "..");
const bootstrap = readFileSync(join(root, "src/lib/bootstrap.ts"), "utf8");
const schema = readFileSync(join(root, "src/db/schema.ts"), "utf8");

/** Column names Drizzle declares, e.g. varchar("file_name", ...) -> file_name. */
function schemaColumns(table: string): string[] {
  const start = schema.indexOf(`pgTable("${table}"`);
  if (start === -1) throw new Error(`table ${table} missing from schema.ts`);
  const body = schema.slice(start, schema.indexOf("});", start));
  return [...body.matchAll(/\b(?:serial|text|integer|jsonb|uuid|varchar|timestamp)\(\s*"([a-z_]+)"/g)]
    .map((m) => m[1]);
}

function bootstrapColumns(table: string): string[] {
  const start = bootstrap.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start === -1) throw new Error(`table ${table} missing from bootstrap.ts`);
  const body = bootstrap.slice(start, bootstrap.indexOf(")\n", start));
  return body
    .split("\n")
    .slice(1)
    .map((line) => line.trim().match(/^([a-z_]+)\s+/)?.[1])
    .filter((c): c is string => Boolean(c));
}

const TABLES = ["writing_samples", "style_profiles", "rewrite_jobs", "ai_scans"];

describe("bootstrap DDL matches schema.ts", () => {
  for (const table of TABLES) {
    it(`${table} declares the same columns in both places`, () => {
      expect(bootstrapColumns(table).sort()).toEqual(schemaColumns(table).sort());
    });
  }
});

describe("generated migrations exist", () => {
  it("has at least one migration checked in", () => {
    const journal = JSON.parse(
      readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThan(0);
  });
});
