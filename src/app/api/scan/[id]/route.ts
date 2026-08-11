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

/** Same enumeration exposure as samples: serial ids, no auth. */
const DELETE_LIMIT = { name: "scan-delete", max: 20, windowMs: 60_000 };

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
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid scan id." }, { status: 400 });
    }
    await db.delete(aiScans).where(eq(aiScans.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/scan/[id]", err);
    return NextResponse.json(
      { error: "Could not delete scan." },
      { status: 500 },
    );
  }
}
