import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Clears the session cookie. Safe to call whether or not the gate is on. */
export async function POST(request: Request) {
  const response = Response.json({ ok: true });
  const secure = new URL(request.url).protocol === "https:";

  response.headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=`,
      "Path=/",
      "Max-Age=0",
      "SameSite=Lax",
      "HttpOnly",
      secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  return response;
}
