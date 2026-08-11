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

function rtfToText(rtf: string): string {
  // Best-effort RTF: drop groups that aren't text, control words, braces.
  return rtf
    .replace(/\{\\[^{}]+\}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\['"][0-9a-fA-F]{2}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
