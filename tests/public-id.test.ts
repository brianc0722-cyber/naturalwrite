import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Serial ids used to be the public handle for deletion, so
 * DELETE /api/samples/1..n wiped every row. Rows are now addressed by a
 * random uuid. These tests lock that in: they fail if a route ever goes
 * back to parsing an integer id, or if the uuid column disappears.
 */

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const schema = read("src/db/schema.ts");
const bootstrap = read("src/lib/bootstrap.ts");
const sampleRoute = read("src/app/api/samples/[id]/route.ts");
const scanRoute = read("src/app/api/scan/[id]/route.ts");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("public_id column", () => {
  for (const table of ["writingSamples", "aiScans"]) {
    it(`${table} declares a unique, non-null public_id uuid`, () => {
      const start = schema.indexOf(`export const ${table} =`);
      expect(start).toBeGreaterThan(-1);
      const body = schema.slice(start, schema.indexOf("});", start));
      expect(body).toContain('uuid("public_id")');
      expect(body).toContain(".notNull()");
      expect(body).toContain(".unique()");
      expect(body).toContain("gen_random_uuid()");
    });
  }

  for (const table of ["writing_samples", "ai_scans"]) {
    it(`${table} bootstrap DDL creates public_id`, () => {
      const start = bootstrap.indexOf(
        `CREATE TABLE IF NOT EXISTS ${table} (`,
      );
      expect(start).toBeGreaterThan(-1);
      const body = bootstrap.slice(start, bootstrap.indexOf(")\n", start));
      expect(body).toMatch(/public_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid\(\)/);
    });
  }

  it("backfills public_id on databases that predate the column", () => {
    // ADD COLUMN IF NOT EXISTS is a no-op on CREATE TABLE IF NOT EXISTS,
    // so an explicit ALTER is the only upgrade path for existing rows.
    expect(bootstrap).toContain("ADD COLUMN IF NOT EXISTS public_id UUID");
    expect(bootstrap).toContain("SET public_id = gen_random_uuid() WHERE public_id IS NULL");
    expect(bootstrap).toContain("ALTER COLUMN public_id SET NOT NULL");
  });
});

describe("delete routes address rows by uuid", () => {
  const routes: [string, string][] = [
    ["samples", sampleRoute],
    ["scan", scanRoute],
  ];

  for (const [name, src] of routes) {
    it(`${name} matches the id against a uuid pattern`, () => {
      expect(src).toContain("UUID_RE");
      expect(src).toMatch(/\[0-9a-f\]\{8\}-/);
    });

    it(`${name} never coerces the id with Number()`, () => {
      expect(src).not.toContain("Number(raw)");
      expect(src).not.toContain("Number.isFinite(id)");
    });

    it(`${name} filters on publicId, not the serial id`, () => {
      expect(src).toContain("publicId, id");
      expect(src).not.toMatch(/eq\((writingSamples|aiScans)\.id,/);
    });

    it(`${name} returns 404 when nothing was deleted`, () => {
      expect(src).toContain("deleted.length === 0");
      expect(src).toContain("status: 404");
    });
  }
});

describe("uuid pattern", () => {
  it("accepts a real uuid and rejects enumerable ids", () => {
    expect(UUID_RE.test("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
    for (const bad of ["1", "42", "0", "-1", "abc", "", "1;DROP TABLE x"]) {
      expect(UUID_RE.test(bad)).toBe(false);
    }
  });
});
