import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The 40-sample quota check used to call listSamples() and read .length,
 * pulling every row's full `content` (up to 40 x 50 KB) out of Postgres on
 * every upload just to compare a number. It now issues COUNT(*).
 */

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const samplesLib = read("src/lib/samples.ts");
const samplesRoute = read("src/app/api/samples/route.ts");

describe("countSamples", () => {
  it("is exported and uses a SQL count aggregate", () => {
    expect(samplesLib).toContain("export async function countSamples");
    const start = samplesLib.indexOf("export async function countSamples");
    const body = samplesLib.slice(start, samplesLib.indexOf("\n}", start));
    expect(body).toContain("count()");
    expect(body).toContain("writingSamples");
    // Must not fall back to materialising rows.
    expect(body).not.toContain("listSamples");
    expect(body).not.toContain(".length");
  });

  it("imports count from drizzle-orm", () => {
    expect(samplesLib).toMatch(/import \{[^}]*\bcount\b[^}]*\} from "drizzle-orm"/);
  });

  it("returns 0 rather than undefined on an empty table", () => {
    const start = samplesLib.indexOf("export async function countSamples");
    const body = samplesLib.slice(start, samplesLib.indexOf("\n}", start));
    expect(body).toContain("?? 0");
  });
});

describe("POST /api/samples quota check", () => {
  it("counts with countSamples, not by listing rows", () => {
    expect(samplesRoute).toContain("await countSamples()");
    expect(samplesRoute).not.toContain("const existing = await listSamples()");
    expect(samplesRoute).not.toContain("existing.length >= MAX_SAMPLES");
  });

  it("still enforces the MAX_SAMPLES ceiling", () => {
    expect(samplesRoute).toContain("existing >= MAX_SAMPLES");
    expect(samplesRoute).toContain("const MAX_SAMPLES = 40");
  });
});
