import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRateLimits,
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "@/lib/rate-limit";

const OPT = { name: "test", max: 3, windowMs: 200 };

beforeEach(() => __resetRateLimits());

describe("checkRateLimit", () => {
  it("allows up to max then blocks", () => {
    const results = [1, 2, 3, 4, 5].map(() => checkRateLimit("1.2.3.4", OPT));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
  });

  it("counts down remaining", () => {
    expect(checkRateLimit("a", OPT).remaining).toBe(2);
    expect(checkRateLimit("a", OPT).remaining).toBe(1);
    expect(checkRateLimit("a", OPT).remaining).toBe(0);
  });

  it("tracks clients independently", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("a", OPT);
    expect(checkRateLimit("a", OPT).ok).toBe(false);
    expect(checkRateLimit("b", OPT).ok).toBe(true);
  });

  it("keeps namespaces separate", () => {
    const n1 = { name: "n1", max: 1, windowMs: 1000 };
    const n2 = { name: "n2", max: 1, windowMs: 1000 };
    checkRateLimit("x", n1);
    expect(checkRateLimit("x", n1).ok).toBe(false);
    expect(checkRateLimit("x", n2).ok).toBe(true);
  });

  it("resets after the window elapses", async () => {
    for (let i = 0; i < 3; i++) checkRateLimit("w", OPT);
    expect(checkRateLimit("w", OPT).ok).toBe(false);
    await new Promise((r) => setTimeout(r, OPT.windowMs + 60));
    expect(checkRateLimit("w", OPT).ok).toBe(true);
  });

  it("reports a positive retryAfter when blocked", () => {
    const long = { name: "long", max: 1, windowMs: 60_000 };
    checkRateLimit("r", long);
    expect(checkRateLimit("r", long).retryAfter).toBeGreaterThan(0);
  });
});

describe("rateLimitHeaders", () => {
  it("omits Retry-After while allowed", () => {
    expect(rateLimitHeaders(checkRateLimit("h", OPT), OPT.max))
      .not.toHaveProperty("Retry-After");
  });

  it("includes Retry-After once blocked", () => {
    const one = { name: "h2", max: 1, windowMs: 5000 };
    checkRateLimit("h", one);
    const headers = rateLimitHeaders(checkRateLimit("h", one), one.max);
    expect(headers["Retry-After"]).toBeDefined();
    expect(headers["RateLimit-Limit"]).toBe("1");
  });
});

describe("clientKeyFromRequest", () => {
  const mk = (h: Record<string, string>) => new Request("http://x", { headers: h });

  it("uses the first x-forwarded-for hop", () => {
    expect(clientKeyFromRequest(mk({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })))
      .toBe("9.9.9.9");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKeyFromRequest(mk({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });

  it("degrades to a constant when no headers are present", () => {
    expect(clientKeyFromRequest(mk({}))).toBe("unknown");
  });
});
