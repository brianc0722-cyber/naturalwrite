import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { __resetRateLimits } from "@/lib/rate-limit";

const ORIGINAL = process.env.APP_PASSWORD;

function post(body: unknown, ip = "203.0.113.10") {
  return new Request("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Pull the session token out of a Set-Cookie header. */
function tokenFrom(res: Response): string | null {
  const cookie = res.headers.get("set-cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match ? match[1] : null;
}

beforeEach(() => {
  __resetRateLimits();
  process.env.APP_PASSWORD = "opensesame";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = ORIGINAL;
});

describe("POST /api/auth/login", () => {
  it("sets a valid HttpOnly session cookie on success", async () => {
    const res = await login(post({ password: "opensesame" }));
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure"); // request URL is https
    expect(cookie).toContain("Path=/");

    await expect(verifySessionToken(tokenFrom(res))).resolves.toBe(true);
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const res = await login(post({ password: "nope" }));
    expect(res.status).toBe(401);
    expect(tokenFrom(res)).toBeNull();
  });

  it("rejects a malformed body", async () => {
    const bad = new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await login(bad)).status).toBe(400);
  });

  it("rejects a missing password field", async () => {
    expect((await login(post({}))).status).toBe(401);
  });

  it("404s when the deployment has no password configured", async () => {
    delete process.env.APP_PASSWORD;
    const res = await login(post({ password: "anything" }));
    expect(res.status).toBe(404);
  });

  it("throttles brute-force attempts", async () => {
    const attacker = "198.51.100.7";
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await login(post({ password: `guess-${i}` }, attacker));
      codes.push(res.status);
    }
    // First 8 are plain rejections, the rest are throttled.
    expect(codes.filter((c) => c === 401).length).toBe(8);
    expect(codes.filter((c) => c === 429).length).toBe(4);
  });

  it("throttles per client, not globally", async () => {
    for (let i = 0; i < 9; i += 1) {
      await login(post({ password: "x" }, "198.51.100.1"));
    }
    // A different client is unaffected and can still authenticate.
    const res = await login(post({ password: "opensesame" }, "198.51.100.2"));
    expect(res.status).toBe(200);
  });

  it("still throttles even when the password is correct", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < 8; i += 1) {
      await login(post({ password: "opensesame" }, ip));
    }
    const res = await login(post({ password: "opensesame" }, ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const res = await logout(
      new Request("https://example.test/api/auth/logout", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});
