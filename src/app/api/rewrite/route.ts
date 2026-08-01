import { NextResponse } from "next/server";
import { db } from "@/db";
import { rewriteJobs } from "@/db/schema";
import { getActiveStyleProfile, rebuildStyleProfile } from "@/lib/samples";
import { rewriteToStyle } from "@/lib/style-analyzer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
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
