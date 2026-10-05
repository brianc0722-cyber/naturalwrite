import { NextRequest, NextResponse } from "next/server";
import { compareDocuments } from "@/lib/plagiarism/compare";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const a = typeof body?.a === "string" ? body.a : "";
    const b = typeof body?.b === "string" ? body.b : "";
    if (!a.trim() || !b.trim()) {
      return NextResponse.json({ error: "Provide two texts to compare." }, { status: 400 });
    }
    return NextResponse.json(compareDocuments(a, b));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compare failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
