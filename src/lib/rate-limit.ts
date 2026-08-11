/**
 * Minimal in-process rate limiter (fixed window, per client key).
 *
 * SCOPE AND LIMITATIONS — read before relying on this:
 *
 *  - State lives in the memory of a single Node process. On a multi-instance
 *    or serverless deployment (e.g. Vercel Functions) each instance keeps its
 *    own counters, so the effective global limit is `max * instanceCount`.
 *  - It is therefore an abuse *dampener*, not a quota system. It stops a
 *    single client hammering one instance in a loop; it does not enforce a
 *    hard spend ceiling on the OpenAI second opinion.
 *  - For a real guarantee, move the counter to Postgres, Redis, or a managed
 *    limiter and keep this module's interface.
 *
 * Client identity is best-effort: the first `x-forwarded-for` hop, falling
 * back to other proxy headers, then to a shared constant. A determined caller
 * can spoof these, which is another reason this is a dampener only.
 */

type Bucket = { count: number; resetAt: number };

/** Keyed by `${name}:${clientKey}`. */
const buckets = new Map<string, Bucket>();

/** Stop the map growing without bound on long-lived servers. */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  ok: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
  /** Seconds until reset — for the `Retry-After` header. */
  retryAfter: number;
};

export type RateLimitOptions = {
  /** Namespace so different routes don't share a counter. */
  name: string;
  /** Max requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/**
 * Best-effort client identifier from proxy headers.
 * Exported for testing.
 */
export function clientKeyFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/** Drop expired buckets; if still oversized, clear entirely (cheap and safe). */
function evictIfNeeded(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
}

/**
 * Consume one token for `clientKey`. Returns whether the call is allowed.
 * Never throws — on any unexpected state it fails open, because a broken
 * limiter must not take the whole app down.
 */
export function checkRateLimit(
  clientKey: string,
  { name, max, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  evictIfNeeded(now);

  const key = `${name}:${clientKey}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      ok: true,
      remaining: Math.max(0, max - 1),
      resetAt,
      retryAfter: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= max;
  return {
    ok: allowed,
    remaining: Math.max(0, max - existing.count),
    resetAt: existing.resetAt,
    retryAfter: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Standard headers so clients can back off intelligently. */
export function rateLimitHeaders(
  result: RateLimitResult,
  max: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(max),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
  if (!result.ok) headers["Retry-After"] = String(Math.max(1, result.retryAfter));
  return headers;
}

/** Test-only: wipe all counters. */
export function __resetRateLimits(): void {
  buckets.clear();
}
