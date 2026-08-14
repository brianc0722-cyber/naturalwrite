import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { grammarChecks } from "@/db/schema";
import { ensureSchema } from "@/lib/bootstrap";
import { checkGrammar, scoreOf, verdictOf } from "@/lib/grammar";
import { getLlmGrammarReview, mergeIssues } from "@/lib/llm-grammar";
import { ExtractError, extractTextFromBuffer } from "@/lib/text-extract";
import { isLatinScript } from "@/lib/tokenize";
import {
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
} from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

const MAX_TEXT = 300_000;

/**
 * Same ceiling as /api/scan: the rule pass is cheap, but the optional LLM
 * review is a paid network call on the same budget as the second opinion.
 */
const GRAMMAR_LIMIT = { name: "grammar", max: 10, windowMs: 60_000 };

/**
 * Below this, the rules have too little to work with and the score is noise —
 * one comma error in eight words reads as a catastrophic document. Lower than
 * the scanner's 120 because mechanics are checkable in a single sentence,
 * where AI-likeness is not.
 */
const MIN_CHARS = 40;

export async function GET() {
  await ensureSchema();
  const checks = await db
    .select()
    .from(grammarChecks)
    .orderBy(desc(grammarChecks.createdAt))
    .limit(20);
  return NextResponse.json({ checks });
}

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit(clientKeyFromRequest(request), GRAMMAR_LIMIT);
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many checks. Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: rateLimitHeaders(limit, GRAMMAR_LIMIT.max) },
      );
    }

    await ensureSchema();
    const contentType = request.headers.get("content-type") ?? "";

    let text = "";
    let fileName = "Pasted text";
    let source = "paste";
    let persist = true;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const pasted = form.get("content");
      const nameField = form.get("name");

      if (file instanceof File) {
        fileName = file.name || "Uploaded document";
        source = "upload";
        if (file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json(
            {
              error: `That file is ${formatBytes(file.size)}. Keep documents under ${MAX_UPLOAD_LABEL}.`,
            },
            { status: 413 },
          );
        }
        if (file.size === 0) {
          return NextResponse.json(
            { error: "That file is empty." },
            { status: 400 },
          );
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        try {
          text = await extractTextFromBuffer(buffer, fileName, file.type);
        } catch (err) {
          if (err instanceof ExtractError) {
            return NextResponse.json({ error: err.message }, { status: 400 });
          }
          throw err;
        }
      } else if (typeof pasted === "string") {
        text = pasted;
        if (typeof nameField === "string" && nameField.trim()) {
          fileName = nameField.trim().slice(0, 255);
        }
      }
    } else {
      const body = (await request.json()) as {
        text?: string;
        name?: string;
        source?: string;
        persist?: boolean;
      };
      text = body.text ?? "";
      if (body.name?.trim()) fileName = body.name.trim().slice(0, 255);
      if (body.source === "rewrite") {
        source = "rewrite";
        fileName = fileName === "Pasted text" ? "Rewritten text" : fileName;
      }
      // The auto-check that runs after every rewrite passes persist:false, so
      // an inline badge does not fill the history list with rows the user
      // never asked for. Explicit checks always persist.
      if (body.persist === false) persist = false;
    }

    text = text.trim();
    if (text.length < MIN_CHARS) {
      return NextResponse.json(
        {
          error:
            "That's too short to check. Paste at least a sentence or two.",
        },
        { status: 400 },
      );
    }
    if (text.length > MAX_TEXT) {
      text = text.slice(0, MAX_TEXT);
    }

    const result = checkGrammar(text);

    // Every rule in the engine is an English rule. Counting words in another
    // script works, but "an hour" and subject-verb agreement do not transfer,
    // so a non-Latin document would score 100/100 and imply it was checked.
    // Refuse for the same reason /api/scan does.
    if (result.stats.wordCount === 0 || !isLatinScript(text)) {
      return NextResponse.json(
        {
          error:
            "This text couldn't be checked. The grammar rules are written for English and other Latin-script writing, so they have nothing meaningful to say about this document.",
        },
        { status: 422 },
      );
    }

    // Optional depth. Null when no key is configured, and the UI reports
    // which mode ran rather than silently degrading.
    const review = await getLlmGrammarReview(text);
    const issues = review
      ? mergeIssues(result.issues, review.issues)
      : result.issues;

    const counts = {
      error: issues.filter((i) => i.severity === "error").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      suggestion: issues.filter((i) => i.severity === "suggestion").length,
      grammar: issues.filter((i) => i.category === "grammar").length,
      mechanics: issues.filter((i) => i.category === "mechanics").length,
      style: issues.filter((i) => i.category === "style").length,
    };

    // Recompute from the merged set so LLM findings move the number too.
    const score = scoreOf(counts, result.stats.wordCount);

    const detection = {
      ...result,
      issues,
      counts,
      score,
      verdict: verdictOf(score),
      llmModel: review?.model ?? null,
      llmTruncated: review?.truncated ?? false,
    };

    let check = null;
    if (persist) {
      [check] = await db
        .insert(grammarChecks)
        .values({
          fileName,
          wordCount: result.stats.wordCount,
          score,
          verdict: detection.verdict,
          errorCount: counts.error,
          warningCount: counts.warning,
          suggestionCount: counts.suggestion,
          source,
          issues,
          stats: result.stats,
          llmModel: review?.model ?? null,
        })
        .returning();
    }

    return NextResponse.json({ check, detection });
  } catch (err) {
    console.error("POST /api/grammar", err);
    return NextResponse.json(
      { error: "The check failed. Try again with a text-based document." },
      { status: 500 },
    );
  }
}
