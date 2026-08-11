import { NextResponse } from "next/server";
import { db } from "@/db";
import { rewriteJobs } from "@/db/schema";
import { getActiveStyleProfile, rebuildStyleProfile } from "@/lib/samples";
import { rewriteToStyle } from "@/lib/style-analyzer";
import { ensureSchema } from "@/lib/bootstrap";
import {
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Rewrites are unbounded in length and persist a row per call. */
const REWRITE_LIMIT = { name: "rewrite", max: 30, windowMs: 60_000 };

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit(clientKeyFromRequest(request), REWRITE_LIMIT);
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many rewrites. Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: rateLimitHeaders(limit, REWRITE_LIMIT.max) },
      );
    }

    await ensureSchema();
    const body = (await request.json()) as { text?: string };
    const text = (body.text ?? "").trim();

    if (!text) {
      return NextResponse.json(
        { error: "Paste some text to rewrite in your voice." },
        { status: 400 },
      );
    }

    let style = await getActiveStyleProfile();
    if (!style) {
      style = await rebuildStyleProfile();
    }

    const { rewritten, notes } = rewriteToStyle(text, style.profile);
    const notesText = notes.join("\n");

    const [job] = await db
      .insert(rewriteJobs)
      .values({
        originalText: text,
        rewrittenText: rewritten,
        notes: notesText,
      })
      .returning();

    return NextResponse.json({
      rewritten,
      notes,
      jobId: job.id,
      styleSummary: style.summary,
      hasSamples: (style.profile.sampleCount ?? 0) > 0,
    });
  } catch (err) {
    console.error("POST /api/rewrite", err);
    return NextResponse.json(
      { error: "Rewrite failed. Try again." },
      { status: 500 },
    );
  }
}
