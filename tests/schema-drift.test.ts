import { existsSync, readFileSync } from "node:fs";
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
  const rest = bootstrap.slice(start);
  const endRel = rest.search(/\)\r?\n/);
  const body = endRel === -1 ? rest : rest.slice(0, endRel);
  return body
    .split("\n")
    .slice(1)
    .map((line) => line.trim().match(/^([a-z_]+)\s+/)?.[1])
    .filter((c): c is string => Boolean(c));
}

const TABLES = [
  "writing_samples",
  "style_profiles",
  "rewrite_jobs",
  "ai_scans",
  "grammar_checks",
];

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

  /**
   * Every journal entry needs BOTH a .sql file and a meta snapshot. A
   * hand-written migration is easy to add without its snapshot, and drizzle
   * then diffs against a schema that has no record of the table — so the next
   * `generate` re-emits a CREATE TABLE that already exists.
   */
  it("every journal entry has a matching .sql file and snapshot", () => {
    const journal = JSON.parse(
      readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };

    for (const entry of journal.entries) {
      const sqlPath = join(root, "drizzle", `${entry.tag}.sql`);
      const snapPath = join(
        root,
        "drizzle/meta",
        `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
      );
      expect(existsSync(sqlPath), `missing ${entry.tag}.sql`).toBe(true);
      expect(existsSync(snapPath), `missing snapshot for ${entry.tag}`).toBe(true);
    }
  });

  it("snapshots form an unbroken prevId chain", () => {
    const journal = JSON.parse(
      readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };

    let prev: string | null = null;
    for (const entry of journal.entries) {
      const snap = JSON.parse(
        readFileSync(
          join(
            root,
            "drizzle/meta",
            `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
          ),
          "utf8",
        ),
      ) as { id: string; prevId: string };

      if (prev !== null) expect(snap.prevId).toBe(prev);
      prev = snap.id;
    }
  });

  it("the newest snapshot knows about every table", () => {
    const journal = JSON.parse(
      readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    const last = journal.entries[journal.entries.length - 1];
    const snap = JSON.parse(
      readFileSync(
        join(
          root,
          "drizzle/meta",
          `${String(last.idx).padStart(4, "0")}_snapshot.json`,
        ),
        "utf8",
      ),
    ) as { tables: Record<string, unknown> };

    const known = Object.keys(snap.tables).map((t) => t.replace(/^public\./, ""));
    expect(known.sort()).toEqual([...TABLES].sort());
  });
});

describe("public_id index guard", () => {
  /**
   * Regression: the backfill loop used to run
   * `CREATE UNIQUE INDEX IF NOT EXISTS <table>_public_id_key`. IF NOT EXISTS
   * only matches the literal NAME, but drizzle's migrations name the same
   * constraint `<table>_public_id_unique` — so a drizzle-provisioned database
   * gained a second, redundant unique index on public_id. The guard must
   * inspect pg_index for a unique index on the COLUMN instead.
   */
  it("checks for an existing unique index by shape, not by name", () => {
    expect(bootstrap).toMatch(/from\s+pg_index/i);
    expect(bootstrap).toMatch(/indisunique/);
    expect(bootstrap).toMatch(/attname\s*=\s*'public_id'/);
  });

  it("performs the pg_index lookup before creating the index", () => {
    // Order matters: the shape lookup has to run first and gate the CREATE.
    const lookup = bootstrap.indexOf("indisunique");
    const create = bootstrap.indexOf("CREATE UNIQUE INDEX");
    expect(lookup).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(create);
  });

  /**
   * The cleanup drops duplicates left behind by the old name-based guard.
   * Two properties must hold or it is worse than the bug it fixes:
   *   1. it must never drop a constraint-backed index (DROP INDEX errors out,
   *      and dropping the constraint would remove the real guarantee), and
   *   2. it must never drop the LAST unique index, which would silently end
   *      uniqueness enforcement on public_id.
   */
  it("only cleans up when more than one unique index exists", () => {
    expect(bootstrap).toMatch(/existing\.rows\.length\s*>\s*1/);
  });

  it("keeps the first row and drops only the remainder", () => {
    expect(bootstrap).toMatch(/existing\.rows\.slice\(1\)/);
  });

  it("skips constraint-backed indexes when dropping", () => {
    expect(bootstrap).toMatch(/constraint_backed/);
    expect(bootstrap).toMatch(/if\s*\(\s*dupe\.constraint_backed\s*\)\s*continue/);
  });

  it("orders constraint-backed indexes first so they are the survivor", () => {
    expect(bootstrap).toMatch(/ORDER BY constraint_backed DESC/);
  });

  it("excludes the primary key from the duplicate scan", () => {
    // Without NOT indisprimary the PK would count as a duplicate on tables
    // where public_id happened to be the first indexed column.
    expect(bootstrap).toMatch(/NOT i\.indisprimary/);
  });

  it("cannot use bind parameters inside a DO block", () => {
    // A DO body is a single string literal; parameters there fail at runtime
    // with "bind message supplies N parameters, but prepared statement
    // requires 0". Keep the guard as a plain parameterized SELECT.
    expect(bootstrap).not.toMatch(/DO\s+\$\$/);
  });
});
