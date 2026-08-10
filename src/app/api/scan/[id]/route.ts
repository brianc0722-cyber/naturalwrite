import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiScans } from "@/db/schema";
import { ensureSchema } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
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
