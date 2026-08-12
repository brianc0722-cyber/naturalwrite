import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Database handle.
 *
 * The DATABASE_URL check is deliberately NOT performed at module scope. Next
 * traces imports at build time, so a top-level throw turned a missing variable
 * into an opaque build/boot failure far from its cause. Everything here is
 * built on first use instead, which means:
 *
 *   - importing this module is free: `next build` and `drizzle-kit generate`
 *     no longer need a connection string just to load it;
 *   - a genuinely missing variable fails at the first real query, with a
 *     message that names the variable.
 *
 * IMPORTANT — do not "simplify" this by wrapping the pg Pool in a Proxy. That
 * was tried: pg reaches into its own instance internals during SASL
 * authentication, and a Proxy in front of Pool makes every connection fail with
 * "client password must be a string". The laziness must live in front of the
 * *drizzle* object, which is only ever used through its query methods.
 */

type Db = ReturnType<typeof drizzle>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsDrizzleDb?: Db;
};

let cachedPool: Pool | undefined;
let cachedDb: Db | undefined;

/** The real connection pool, created on first use. */
export function getPool(): Pool {
  const existing = cachedPool ?? globalForDb.__arenaNextJsPostgresqlPool;
  if (existing) {
    cachedPool = existing;
    return existing;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Set it in your environment (see .env.example) before the app handles a request.",
    );
  }

  const created = new Pool({ connectionString: databaseUrl });
  cachedPool = created;
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = created;
  }
  return created;
}

/** The real drizzle client, created on first use. */
export function getDb(): Db {
  const existing = cachedDb ?? globalForDb.__arenaNextJsDrizzleDb;
  if (existing) {
    cachedDb = existing;
    return existing;
  }

  // Pass the genuine Pool — never a wrapper. See the note above.
  const created = drizzle(getPool());
  cachedDb = created;
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsDrizzleDb = created;
  }
  return created;
}

/**
 * `pool` is retained as a named export for compatibility with existing
 * importers. It is a getter, so referencing the binding is free and only
 * property access builds the pool.
 */
export const pool = new Proxy({} as Pool, {
  get(_target, property) {
    const real = getPool();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/**
 * `db` forwards every property access to the real drizzle client. Drizzle is a
 * plain query builder with no internal `this` sensitivity of the kind pg has,
 * so this is safe — and it is the layer every caller actually touches.
 */
export const db = new Proxy({} as Db, {
  get(_target, property) {
    const real = getDb();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
