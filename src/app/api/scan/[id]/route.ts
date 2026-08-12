import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiScans } from "@/db/schema";
import { ensureSchema } from "@/lib/bootstrap";
import {
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const DELETE_LIMIT = { name: "scan-delete", max: 20, windowMs: 60_000 };

/** Rows are addressed by their unguessable public_id, never the serial id. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  try {
    const limit = checkRateLimit(clientKeyFromRequest(request), DELETE_LIMIT);
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many deletions. Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: rateLimitHeaders(limit, DELETE_LIMIT.max) },
      );
    }

    await ensureSchema();
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid scan id." }, { status: 400 });
    }

    const deleted = await db
      .delete(aiScans)
      .where(eq(aiScans.publicId, id))
      .returning();

    // Previously returned ok:true even when nothing matched, so the UI
    // reported success for ids that were never there.
    if (deleted.length === 0) {
      return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/scan/[id]", err);
    return NextResponse.json(
      { error: "Could not delete scan." },
      { status: 500 },
    );
  }
}
