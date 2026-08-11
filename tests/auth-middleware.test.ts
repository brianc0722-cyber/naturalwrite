import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth";
import { __resetRateLimits } from "@/lib/rate-limit";

const ORIGINAL = process.env.APP_PASSWORD;
const BASE = "https://example.test";

function req(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(new URL(path, BASE), { headers });
}

beforeEach(() => {
  __resetRateLimits();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = ORIGINAL;
});

describe("middleware with the gate DISABLED", () => {
  beforeEach(() => {
    delete process.env.APP_PASSWORD;
  });

  it("passes every route straight through", async () => {
    for (const path of ["/", "/api/samples", "/api/scan", "/login"]) {
      const res = await middleware(req(path));
      // NextResponse.next() carries no redirect and no error status.
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});

describe("middleware with the gate ENABLED", () => {
  beforeEach(() => {
    process.env.APP_PASSWORD = "letmein";
  });

  it("redirects unauthenticated page requests to /login", async () => {
    const res = await middleware(req("/"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
  });

  it("preserves the original path in ?next=", async () => {
    const res = await middleware(req("/some/page"));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/some/page");
  });

  it("returns 401 JSON for API routes rather than an HTML redirect", async () => {
    const res = await middleware(req("/api/samples"));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    await expect(res.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("leaves the login page and auth endpoints reachable", async () => {
    for (const path of ["/login", "/api/auth/login", "/api/auth/logout"]) {
      const res = await middleware(req(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("keeps /api/health public for uptime probes", async () => {
    const res = await middleware(req("/api/health"));
    expect(res.status).toBe(200);
  });

  it("keeps PWA assets public so install still works at the lock screen", async () => {
    for (const path of ["/manifest.json", "/sw.js", "/icon-192.png"]) {
      const res = await middleware(req(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("admits a request carrying a valid session cookie", async () => {
    const token = await createSessionToken();
    const res = await middleware(req("/api/samples", token!));
    expect(res.status).toBe(200);
  });

  it("rejects a forged session cookie", async () => {
    const res = await middleware(req("/api/samples", "9999999999.forged"));
    expect(res.status).toBe(401);
  });
});
