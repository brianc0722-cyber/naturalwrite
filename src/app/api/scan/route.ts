import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { aiScans } from "@/db/schema";
import { ensureSchema } from "@/lib/bootstrap";
import { detectAi } from "@/lib/ai-detector";
import { ExtractError, extractTextFromBuffer } from "@/lib/text-extract";
import { getActiveStyleProfile } from "@/lib/samples";
import { getAiSecondOpinion } from "@/lib/llm-opinion";
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
 * Scanning is the most expensive route: text extraction, then an optional
 * paid LLM call. Limited more tightly than the rest.
 */
const SCAN_LIMIT = { name: "scan", max: 10, windowMs: 60_000 };

export async function GET() {
  await ensureSchema();
  const scans = await db
    .select()
    .from(aiScans)
    .orderBy(desc(aiScans.createdAt))
    .limit(20);
  return NextResponse.json({ scans });
}

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit(clientKeyFromRequest(request), SCAN_LIMIT);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: `Too many scans. Try again in ${limit.retryAfter}s.`,
        },
        {
          status: 429,
          headers: rateLimitHeaders(limit, SCAN_LIMIT.max),
        },
      );
    }

    await ensureSchema();
    const contentType = request.headers.get("content-type") ?? "";

    let text = "";
    let fileName = "Pasted text";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const pasted = form.get("content");
      const nameField = form.get("name");

      if (file instanceof File) {
        fileName = file.name || "Uploaded document";
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
      const body = (await request.json()) as { text?: string; name?: string };
      text = body.text ?? "";
      if (body.name?.trim()) fileName = body.name.trim().slice(0, 255);
    }

    text = text.trim();
    if (text.length < 120) {
      return NextResponse.json(
        {
          error:
            "That's too short to scan reliably. Upload a fuller document or paste at least a solid paragraph.",
        },
        { status: 400 },
      );
    }
    if (text.length > MAX_TEXT) {
      text = text.slice(0, MAX_TEXT);
    }

    const style = await getActiveStyleProfile();
    const base = detectAi(text, style?.profile ?? null);

    // The heuristics tokenize Latin script only. On other writing systems every
    // token is stripped, so the detector would return its neutral starting prior
    // (18) dressed up as a real verdict — a confident-looking score for text it
    // never actually read. Refuse instead, before spending an LLM call or
    // persisting a meaningless row.
    if (base.wordCount === 0) {
      return NextResponse.json(
        {
          error:
            "This text couldn't be analyzed. The scanner currently understands Latin-script languages (English and similar); it found no readable words here.",
        },
        { status: 422 },
      );
    }

    const aiOpinion = await getAiSecondOpinion(text, base.score);
    const detection = { ...base, aiOpinion };

    const [scan] = await db
      .insert(aiScans)
      .values({
        fileName,
        wordCount: detection.wordCount,
        score: detection.score,
        verdict: detection.verdict,
        signals: detection.signals,
        styleMatch: detection.styleMatch,
        aiOpinion,
      })
      .returning();

    return NextResponse.json({
      scan,
      detection,
      hasProfile: !!style && style.profile.sampleCount > 0,
    });
  } catch (err) {
    console.error("POST /api/scan", err);
    return NextResponse.json(
      { error: "The scan failed. Try again with a text-based document." },
      { status: 500 },
    );
  }
}
