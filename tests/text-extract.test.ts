import { describe, expect, it } from "vitest";
import { ExtractError, extractTextFromBuffer } from "@/lib/text-extract";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("extractTextFromBuffer — HTML (fix 1.5)", () => {
  const HTML = `<!doctype html><html><head><style>p{color:red}</style>
    <script>var x = 1;</script></head><body><h1>Chapter One</h1>
    <p>The rain came at four &amp; stayed.</p></body></html>`;

  it("strips tags when the mime type is text/html", async () => {
    const out = await extractTextFromBuffer(buf(HTML), "a.html", "text/html");
    expect(out).toBe("Chapter One The rain came at four & stayed.");
  });

  it("strips tags when the mime type is missing (regression)", async () => {
    // Previously the `text/*` branch ran first and returned raw markup.
    const out = await extractTextFromBuffer(buf(HTML), "a.html", "");
    expect(out).toBe("Chapter One The rain came at four & stayed.");
    expect(out).not.toContain("<");
  });

  it("drops script and style contents", async () => {
    const out = await extractTextFromBuffer(buf(HTML), "a.html", "text/html");
    expect(out).not.toMatch(/var x|color:red/);
  });
});

describe("extractTextFromBuffer — RTF (fix 1.8)", () => {
  it("decodes hex escapes instead of dropping the character", async () => {
    // Regression: an earlier fix replaced \'hh with a space -> "Caf notes".
    const rtf = String.raw`{\rtf1\ansi Caf\'e9 notes: the r\'e9sum\'e9 was fine.}`;
    const out = await extractTextFromBuffer(buf(rtf), "a.rtf", "");
    expect(out).toBe("Café notes: the résumé was fine.");
  });

  it("unescapes literal braces and backslashes", async () => {
    const rtf = String.raw`{\rtf1\ansi a \{b\} c}`;
    expect(await extractTextFromBuffer(buf(rtf), "a.rtf", "")).toContain("{b}");
  });
});

describe("extractTextFromBuffer — plain text", () => {
  it("passes .txt through unchanged", async () => {
    expect(await extractTextFromBuffer(buf("plain text stays plain"), "a.txt", "text/plain"))
      .toBe("plain text stays plain");
  });

  it("preserves markdown structure", async () => {
    expect(await extractTextFromBuffer(buf("# Title\n\nbody"), "a.md", "text/markdown"))
      .toBe("# Title\n\nbody");
  });
});

describe("extractTextFromBuffer — unsupported types", () => {
  it("rejects .xlsx with actionable guidance", async () => {
    await expect(extractTextFromBuffer(buf("PK\u0003\u0004"), "sheet.xlsx", ""))
      .rejects.toBeInstanceOf(ExtractError);

    const err = await extractTextFromBuffer(buf("PK"), "sheet.xlsx", "").catch((e) => e);
    expect(err.message).toMatch(/\.txt, \.md, \.docx, \.pdf, \.html, or \.rtf/);
  });
});
