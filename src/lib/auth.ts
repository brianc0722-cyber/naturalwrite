/**
 * Optional single-password gate.
 *
 * DESIGN INTENT — read before changing:
 *
 *  - This is opt-in. If `APP_PASSWORD` is unset or blank, `authEnabled()`
 *    returns false and the middleware lets every request through untouched.
 *    Local development, existing deployments, and the test suite therefore
 *    behave exactly as they did before this file existed.
 *  - It is a *shared* secret, not user accounts. It answers "is this my
 *    deployment's owner?" and nothing else. It provides no per-user data
 *    separation and no audit trail — the app's data model (one style profile,
 *    one sample library, one scan history) is single-tenant by design.
 *  - What it actually closes: an unauthenticated stranger who finds the URL
 *    can currently read every sample and scan, and can wipe the library by
 *    walking serial IDs through DELETE /api/samples/:id.
 *
 * Session format: `<expiryEpochSeconds>.<base64url HMAC-SHA256>` where the MAC
 * covers the expiry string and is keyed by the password itself. That means
 * changing APP_PASSWORD instantly invalidates every outstanding session, which
 * is the behaviour you want from a shared credential.
 *
 * Everything here uses Web Crypto only, so it runs unchanged in the Edge
 * runtime that Next.js middleware executes in.
 */

export const SESSION_COOKIE = "nw_session";

/** How long a successful login stays valid. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** The configured password, or null when the gate is disabled. */
function configuredPassword(): string | null {
  const raw = process.env.APP_PASSWORD;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when a password is configured and the gate should be enforced. */
export function authEnabled(): boolean {
  return configuredPassword() !== null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message),
  );
  return toBase64Url(new Uint8Array(signature));
}

/**
 * Length-independent constant-time-ish comparison.
 *
 * Both inputs are hashed first so the loop always runs over equal-length
 * digests, which avoids leaking length through early exit. Enough for a
 * low-traffic self-hosted gate.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac("cmp", a), hmac("cmp", b)]);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i += 1) {
    diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  }
  return diff === 0;
}

/** Verify a user-submitted password against `APP_PASSWORD`. */
export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = configuredPassword();
  if (expected === null) return false;
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  return safeEqual(candidate, expected);
}

/** Mint a signed session token. Caller stores it in an HttpOnly cookie. */
export async function createSessionToken(): Promise<string | null> {
  const password = configuredPassword();
  if (password === null) return null;
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const signature = await hmac(password, String(expiry));
  return `${expiry}.${signature}`;
}

/** Validate a session cookie value: correct signature and not expired. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  const password = configuredPassword();
  if (password === null) return true; // gate disabled -> everything is valid
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const expiryPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);

  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = await hmac(password, expiryPart);
  return safeEqual(signaturePart, expected);
}

/** Cookie attributes shared by the login and logout routes. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export { SESSION_TTL_SECONDS };
