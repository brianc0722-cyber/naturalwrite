/**
 * Extracts plain text from uploaded documents of many types:
 * plain text / markdown / csv / log / json, HTML, RTF (best-effort),
 * DOCX (via mammoth), and PDF (via unpdf).
 *
 * Throws ExtractError with a friendly message for unsupported types
 * (images, spreadsheets, archives, etc.).
 */

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "text",
  "csv",
  "tsv",
  "log",
  "json",
  "js",
  "ts",
  "jsx",
  "tsx",
  "css",
  "xml",
  "yml",
  "yaml",
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

/**
 * RTF "destination" groups whose contents are metadata, not document text.
 * Only these are dropped wholesale. The previous rule deleted ANY group
 * beginning with a control word (`/\{\\[^{}]+\}/`), which erased the whole
 * file for a minimal document like `{\rtf1\ansi Café notes.}` — the outer
 * group matched because it contained no nested braces.
 */
const RTF_DROP_GROUPS =
  /\{\\\*?\\?(?:fonttbl|colortbl|stylesheet|info|pict|object|header|footer|footnote|generator|listtable|listoverridetable|rsidtbl|themedata|colorschememapping|latentstyles|datastore|xmlnstbl)\b[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi;

function rtfToText(rtf: string): string {
  // Best-effort RTF: drop metadata groups, decode escapes, strip control words.
  return (
    rtf
      .replace(RTF_DROP_GROUPS, " ")
      // Hex escapes must be handled BEFORE control words are stripped —
      // the control-word rule would otherwise consume the leading
      // backslash and leave the hex digits behind as stray text. Decode
      // them (cp1252-ish) rather than blanking them, so "caf\'e9" becomes
      // "café" instead of losing the character entirely.
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      // Escaped literals \\ \{ \} are real characters, but the structural
      // brace-strip below would eat the braces. Park them on sentinels
      // (chars that cannot appear in RTF source) and restore at the end.
      .replace(/\\\\/g, "\u0001")
      .replace(/\\\{/g, "\u0002")
      .replace(/\\\}/g, "\u0003")
      .replace(/\\~/g, " ")
      // \par, \line, \tab and friends are breaks, not word separators.
      .replace(/\\(?:par|line|sect|page)\b ?/g, "\n")
      .replace(/\\tab\b ?/g, "\t")
      .replace(/\\[a-zA-Z]+-?\d* ?/g, " ")
      .replace(/[{}]/g, "")
      .replace(/\u0001/g, "\\")
      .replace(/\u0002/g, "{")
      .replace(/\u0003/g, "}")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim()
  );
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const lower = fileName.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";

  // HTML must be tested BEFORE the generic text branch: browsers send
  // .html files as "text/html", which matches `startsWith("text/")`, so
  // the plain-text branch used to win and markup reached the detector
  // verbatim (tags, entities and all).
  if (ext === "html" || ext === "htm" || mimeType.includes("html")) {
    return htmlToText(buffer.toString("utf8"));
  }

  if (TEXT_EXTS.has(ext) || mimeType.startsWith("text/")) {
    return buffer.toString("utf8").replace(/\u0000/g, "").trim();
  }

  if (ext === "rtf" || mimeType.includes("rtf")) {
    return rtfToText(buffer.toString("utf8"));
  }

  if (ext === "docx" || mimeType.includes("officedocument.wordprocessingml")) {
    try {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value ?? "").trim();
      if (!text) {
        throw new ExtractError("The DOCX file appears to be empty.");
      }
      return text;
    } catch (err) {
      if (err instanceof ExtractError) throw err;
      throw new ExtractError(
        "Could not read that DOCX file. Try exporting it as .txt or .md.",
      );
    }
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    try {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), {
        mergePages: true,
      });
      const text = String(result.text ?? "").trim();
      if (!text) {
        throw new ExtractError(
          "No readable text found in that PDF (it may be a scanned image).",
        );
      }
      return text;
    } catch (err) {
      if (err instanceof ExtractError) throw err;
      throw new ExtractError(
        "Could not read that PDF. Try exporting it as .txt or .md.",
      );
    }
  }

  if (ext === "doc") {
    throw new ExtractError(
      "Old .doc files aren't supported — re-save it as .docx or .txt and upload again.",
    );
  }

  const imageTypes = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"];
  if (imageTypes.includes(ext) || mimeType.startsWith("image/")) {
    throw new ExtractError(
      "Images can't be scanned as text (OCR isn't included). Paste the text instead.",
    );
  }

  throw new ExtractError(
    `“.${ext || "unknown"}” files can't be read as text. Upload .txt, .md, .docx, .pdf, .html, or .rtf — or paste the text directly.`,
  );
}
