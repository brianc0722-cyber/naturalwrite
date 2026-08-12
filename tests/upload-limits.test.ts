import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scanner used to advertise and enforce 8 MB, but Vercel rejects request
 * bodies over 4.5 MB at the platform level before route code runs, so any
 * upload between 4.5 and 8 MB died with an opaque 413 and no JSON body. The
 * limit now defaults to 4 MB and lives in one module shared by API and UI.
 */

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const VERCEL_BODY_CAP = 4.5 * 1024 * 1024;

async function loadFresh() {
  vi.resetModules();
  return import("@/lib/upload-limits");
}

const ORIGINAL = {
  pub: process.env.NEXT_PUBLIC_MAX_UPLOAD_MB,
  priv: process.env.MAX_UPLOAD_MB,
};

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_MAX_UPLOAD_MB;
  delete process.env.MAX_UPLOAD_MB;
});

afterEach(() => {
  if (ORIGINAL.pub === undefined) delete process.env.NEXT_PUBLIC_MAX_UPLOAD_MB;
  else process.env.NEXT_PUBLIC_MAX_UPLOAD_MB = ORIGINAL.pub;
  if (ORIGINAL.priv === undefined) delete process.env.MAX_UPLOAD_MB;
  else process.env.MAX_UPLOAD_MB = ORIGINAL.priv;
});

describe("default limit", () => {
  it("defaults to 4 MB", async () => {
    const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } =
      await loadFresh();
    expect(MAX_UPLOAD_MB).toBe(4);
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_UPLOAD_LABEL).toBe("4 MB");
  });

  it("leaves headroom under Vercel's 4.5 MB body cap", async () => {
    // Multipart encoding inflates the body past the raw file size, so the
    // limit must sit strictly below the platform cap, not at it.
    const { MAX_UPLOAD_BYTES } = await loadFresh();
    expect(MAX_UPLOAD_BYTES).toBeLessThan(VERCEL_BODY_CAP);
  });
});

describe("env overrides", () => {
  it("honours NEXT_PUBLIC_MAX_UPLOAD_MB", async () => {
    process.env.NEXT_PUBLIC_MAX_UPLOAD_MB = "16";
    const { MAX_UPLOAD_MB, MAX_UPLOAD_LABEL } = await loadFresh();
    expect(MAX_UPLOAD_MB).toBe(16);
    expect(MAX_UPLOAD_LABEL).toBe("16 MB");
  });

  it("falls back to MAX_UPLOAD_MB on the server", async () => {
    process.env.MAX_UPLOAD_MB = "10";
    const { MAX_UPLOAD_MB } = await loadFresh();
    expect(MAX_UPLOAD_MB).toBe(10);
  });

  it("prefers the public var when both are set", async () => {
    process.env.NEXT_PUBLIC_MAX_UPLOAD_MB = "12";
    process.env.MAX_UPLOAD_MB = "99";
    const { MAX_UPLOAD_MB } = await loadFresh();
    expect(MAX_UPLOAD_MB).toBe(12);
  });

  for (const bad of ["", "abc", "0", "-5", "NaN"]) {
    it(`ignores the junk value ${JSON.stringify(bad)}`, async () => {
      process.env.MAX_UPLOAD_MB = bad;
      const { MAX_UPLOAD_MB } = await loadFresh();
      expect(MAX_UPLOAD_MB).toBe(4);
    });
  }

  it("renders a fractional limit with one decimal", async () => {
    process.env.MAX_UPLOAD_MB = "2.5";
    const { MAX_UPLOAD_LABEL, MAX_UPLOAD_BYTES } = await loadFresh();
    expect(MAX_UPLOAD_LABEL).toBe("2.5 MB");
    expect(MAX_UPLOAD_BYTES).toBe(Math.floor(2.5 * 1024 * 1024));
  });
});

describe("formatBytes", () => {
  it("formats each magnitude readably", async () => {
    const { formatBytes } = await loadFresh();
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(6 * 1024 * 1024)).toBe("6.0 MB");
  });
});

describe("callers agree with the shared module", () => {
  it("the scan route enforces the shared limit and returns 413", async () => {
    const src = read("src/app/api/scan/route.ts");
    expect(src).toContain("MAX_UPLOAD_BYTES");
    expect(src).toContain("status: 413");
    // The old hardcoded 8 MB ceiling must be gone.
    expect(src).not.toContain("8 * 1024 * 1024");
    expect(src).not.toContain("under 8 MB");
  });

  it("the scanner UI checks size before uploading", async () => {
    const src = read("src/components/ai-scanner.tsx");
    expect(src).toContain("MAX_UPLOAD_BYTES");
    expect(src).toContain("MAX_UPLOAD_LABEL");
    // No stale "max 8 MB" copy promising a size the server rejects.
    expect(src).not.toContain("max 8 MB");
  });

  it("documents both env vars in .env.example", async () => {
    const src = read(".env.example");
    expect(src).toContain("MAX_UPLOAD_MB=");
    expect(src).toContain("NEXT_PUBLIC_MAX_UPLOAD_MB=");
  });
});
