import { describe, expect, it } from "vitest";

/**
 * src/db/index.ts must not read DATABASE_URL at import time.
 *
 * A top-level throw made `next build` and `drizzle-kit generate` fail with an
 * opaque error whenever the variable was absent, even though neither runs a
 * query. These tests pin the lazy behaviour so it cannot regress.
 */
describe("db module laziness", () => {
  it("imports cleanly with no DATABASE_URL set", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const mod = await import("@/db");
      expect(mod.db).toBeDefined();
      expect(mod.pool).toBeDefined();
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it("throws a message naming DATABASE_URL when a pool is actually needed", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const mod = await import("@/db");
      expect(() => mod.getPool()).toThrow(/DATABASE_URL is required/);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
