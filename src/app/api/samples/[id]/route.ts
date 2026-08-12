import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { writingSamples } from "@/db/schema";
import { rebuildStyleProfile } from "@/lib/samples";
import { ensureSchema } from "@/lib/bootstrap";
import {
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const DELETE_LIMIT = { name: "samples-delete", max: 20, windowMs: 60_000 };

/**
 * Rows are addressed by their unguessable public_id. With serial ids,
 * DELETE /api/samples/1..n wiped the whole table; rate limiting only slowed
 * that down. A random uuid removes the enumeration entirely.
 */
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
      return NextResponse.json({ error: "Invalid sample id." }, { status: 400 });
    }

    const deleted = await db
      .delete(writingSamples)
      .where(eq(writingSamples.publicId, id))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Sample not found." }, { status: 404 });
    }

    const style = await rebuildStyleProfile();
    return NextResponse.json({ ok: true, style });
  } catch (err) {
    console.error("DELETE /api/samples/[id]", err);
    return NextResponse.json(
      { error: "Could not delete sample." },
      { status: 500 },
    );
  }
}
