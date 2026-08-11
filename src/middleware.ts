import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifySessionToken } from "@/lib/auth";

/**
 * Enforces the optional single-password gate.
 *
 * When APP_PASSWORD is unset this is a no-op pass-through, so the app's
 * behaviour is byte-for-byte what it was before auth existed.
 *
 * When it IS set:
 *   - unauthenticated page requests  -> redirect to /login?next=<path>
 *   - unauthenticated API requests   -> 401 JSON (never an HTML redirect,
 *     which would corrupt fetch() callers in the client components)
 *
 * Always public: /login, the auth endpoints, /api/health (so uptime probes and
 * platform health checks keep working), and static/PWA assets. The service
 * worker and manifest must stay reachable or the install flow breaks at the
 * lock screen.
 */

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/manifest.json",
  "/sw.js",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Next.js build output and image optimizer.
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  // API callers get a machine-readable failure, not a redirect to HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  const target = `${pathname}${search}`;
  if (target && target !== "/") loginUrl.searchParams.set("next", target);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static files; the handler
  // itself does the finer-grained public-path filtering above.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
