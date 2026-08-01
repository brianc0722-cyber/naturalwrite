import { NextResponse } from "next/server";
import { getActiveStyleProfile, rebuildStyleProfile } from "@/lib/samples";

export const dynamic = "force-dynamic";

export async function GET() {
  let style = await getActiveStyleProfile();
  if (!style) {
    style = await rebuildStyleProfile();
  }
  return NextResponse.json({ style });
}

export async function POST() {
  const style = await rebuildStyleProfile();
  return NextResponse.json({ style });
}
