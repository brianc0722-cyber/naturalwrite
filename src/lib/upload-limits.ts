/**
 * Upload size limits, defined once and shared by the API route and the UI so
 * the number a user sees is the number the server enforces.
 *
 * Vercel caps the request body of a serverless function at 4.5 MB at the
 * platform level. That check runs before any application code, so a larger
 * upload never reaches the route: the client gets an opaque 413
 * FUNCTION_PAYLOAD_TOO_LARGE with no JSON error body, and no config flag
 * raises it. The app-level limit therefore has to sit *below* the platform
 * limit, otherwise the route advertises a ceiling it can never honour.
 *
 * Headroom: multipart encoding adds boundary lines and headers to the raw
 * file bytes, so the encoded body is slightly larger than the file itself.
 * 4 MB of file leaves ~0.5 MB of room under the 4.5 MB cap.
 *
 * Self-hosting (VPS, Docker, Render, Fly) has no such cap — raise it by
 * setting BOTH env vars to the same value:
 *
 *   MAX_UPLOAD_MB=16              # enforced by the API route
 *   NEXT_PUBLIC_MAX_UPLOAD_MB=16  # shown in the UI and pre-checked there
 *
 * Two variables are needed because Next.js only inlines NEXT_PUBLIC_* into
 * the browser bundle; a bare MAX_UPLOAD_MB is undefined on the client and
 * the UI would silently fall back to the default. Values above ~4 break on
 * Vercel. If only one is set, the stricter of the two wins on its own side,
 * so the server is never more permissive than it claims.
 */
const DEFAULT_MAX_UPLOAD_MB = 4;

function resolveMaxUploadMb(): number {
  // On the client only the NEXT_PUBLIC_ form survives bundling.
  const raw =
    process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? process.env.MAX_UPLOAD_MB;
  if (!raw) return DEFAULT_MAX_UPLOAD_MB;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_UPLOAD_MB;
  return parsed;
}

export const MAX_UPLOAD_MB = resolveMaxUploadMb();
export const MAX_UPLOAD_BYTES = Math.floor(MAX_UPLOAD_MB * 1024 * 1024);

/** Human-readable limit for UI copy and error messages, e.g. "4 MB". */
export const MAX_UPLOAD_LABEL = `${
  Number.isInteger(MAX_UPLOAD_MB) ? MAX_UPLOAD_MB : MAX_UPLOAD_MB.toFixed(1)
} MB`;

/**
 * Writing samples are a separate, much smaller limit than scanner documents:
 * they are stored as text and every upload triggers a full profile rebuild
 * over the whole library, so a huge sample is a cost multiplier rather than a
 * one-off. Shared with the client so the dropzone can reject an oversized file
 * before spending the upload.
 */
export const MAX_SAMPLE_CHARS = 50_000;

/** File-size ceiling for a sample upload; ~2 bytes per character of headroom. */
export const MAX_SAMPLE_FILE_BYTES = MAX_SAMPLE_CHARS * 2;

/** Human-readable sample limit for UI copy, e.g. "50 KB". */
export const MAX_SAMPLE_LABEL = `${Math.round(MAX_SAMPLE_CHARS / 1000)} KB`;

/** Formats a byte count for error messages, e.g. "6.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
