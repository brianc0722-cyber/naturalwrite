import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimits } from "@/lib/rate-limit";

/**
 * Route-level tests with the database mocked out. The key property: when a
 * caller is over the limit the handler returns 429 *before* doing any DB or
 * LLM work, so throttling actually protects those resources.
 */

const ensureSchema = vi.fn(async () => {});
const insertReturning = vi.fn(async () => [{ id: 1 }]);

vi.mock("@/lib/bootstrap", () => ({ ensureSchema }));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
    select: () => ({
      from: () => ({ orderBy: () => ({ limit: async () => [] }) }),
    }),
  },
}));

vi.mock("@/lib/samples", () => ({
  getActiveStyleProfile: async () => null,
  listSamples: async () => [],
  rebuildStyleProfile: async () => ({ profile: { sampleCount: 0 }, summary: "" }),
  countWords: (s: string) => s.split(/\s+/).length,
}));

// Never call a real model in tests.
vi.mock("@/lib/llm-opinion", () => ({ getAiSecondOpinion: async () => null }));

const { POST } = await import("@/app/api/scan/route");

const LONG_TEXT =
  "This is a sufficiently long document for the scanner to accept it. ".repeat(5);

function scanRequest(ip: string) {
  return new Request("http://localhost/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ text: LONG_TEXT, name: "test.txt" }),
  });
}

beforeEach(() => {
  __resetRateLimits();
  ensureSchema.mockClear();
  insertReturning.mockClear();
});

describe("POST /api/scan rate limiting", () => {
  it("allows the first 10 requests and blocks the 11th", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await POST(scanRequest("5.5.5.5"))).status);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("does not touch the database once throttled", async () => {
    for (let i = 0; i < 10; i++) await POST(scanRequest("6.6.6.6"));
    const insertsBefore = insertReturning.mock.calls.length;
    const schemaBefore = ensureSchema.mock.calls.length;

    const blocked = await POST(scanRequest("6.6.6.6"));

    expect(blocked.status).toBe(429);
    expect(insertReturning.mock.calls.length).toBe(insertsBefore);
    expect(ensureSchema.mock.calls.length).toBe(schemaBefore);
  });

  it("returns Retry-After and a friendly message", async () => {
    for (let i = 0; i < 10; i++) await POST(scanRequest("7.7.7.7"));
    const res = await POST(scanRequest("7.7.7.7"));
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect((await res.json()).error).toMatch(/too many scans/i);
  });

  it("throttles per client, not globally", async () => {
    for (let i = 0; i < 10; i++) await POST(scanRequest("8.8.8.8"));
    expect((await POST(scanRequest("8.8.8.8"))).status).toBe(429);
    expect((await POST(scanRequest("9.9.9.9"))).status).toBe(200);
  });

  it("still rejects too-short text with 400, not 429", async () => {
    const res = await POST(
      new Request("http://localhost/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "4.4.4.4" },
        body: JSON.stringify({ text: "too short" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
