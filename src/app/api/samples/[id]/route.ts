import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { writingSamples } from "@/db/schema";
import { rebuildStyleProfile } from "@/lib/samples";
import { ensureSchema } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await ensureSchema();
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid sample id." }, { status: 400 });
    }

    const deleted = await db
      .delete(writingSamples)
      .where(eq(writingSamples.id, id))
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
