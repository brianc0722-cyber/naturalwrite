import { NextResponse } from "next/server";
import { getActiveStyleProfile, rebuildStyleProfile } from "@/lib/samples";
import { ensureSchema } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  let style = await getActiveStyleProfile();
  if (!style) {
    style = await rebuildStyleProfile();
  }
  return NextResponse.json({ style });
}

export async function POST() {
  await ensureSchema();
  const style = await rebuildStyleProfile();
  return NextResponse.json({ style });
}
