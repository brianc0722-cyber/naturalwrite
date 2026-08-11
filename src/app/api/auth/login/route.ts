import {
  SESSION_COOKIE,
  authEnabled,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import {
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Deliberately tight: this endpoint guards a single shared secret. */
const LOGIN_MAX = 8;
const LOGIN_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  if (!authEnabled()) {
    return Response.json(
      { error: "Password protection is not enabled on this deployment." },
      { status: 404 },
    );
  }

  // Throttle before doing any crypto work, so guessing is expensive.
  const limit = checkRateLimit(clientKeyFromRequest(request), {
    name: "auth-login",
    max: LOGIN_MAX,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "Too many attempts. Please wait and try again." },
      { status: 429, headers: rateLimitHeaders(limit, LOGIN_MAX) },
    );
  }

  let password = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "password" in body) {
      const value = (body as { password: unknown }).password;
      if (typeof value === "string") password = value;
    }
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!(await verifyPassword(password))) {
    return Response.json(
      { error: "Incorrect password." },
      { status: 401, headers: rateLimitHeaders(limit, LOGIN_MAX) },
    );
  }

  const token = await createSessionToken();
  if (!token) {
    return Response.json({ error: "Could not start session." }, { status: 500 });
  }

  const response = Response.json({ ok: true });
  const secure = new URL(request.url).protocol === "https:";
  const options = sessionCookieOptions(secure);

  response.headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${token}`,
      `Path=${options.path}`,
      `Max-Age=${options.maxAge}`,
      `SameSite=Lax`,
      "HttpOnly",
      options.secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  return response;
}
