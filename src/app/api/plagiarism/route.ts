import { NextRequest, NextResponse } from "next/server";
import { scanText } from "@/lib/plagiarism/scan";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) {
      return NextResponse.json({ error: "Paste some text to scan." }, { status: 400 });
    }
    if (text.length > 40000) {
      return NextResponse.json(
        { error: "Text is too long. Please scan 40,000 characters or fewer." },
        { status: 400 },
      );
    }
    const result = await scanText(text, {
      serpKey: process.env.SERPAPI_KEY,
      braveKey: process.env.BRAVE_API_KEY,
      winstonKey: process.env.WINSTON_API_KEY || process.env.WINSTON_AI_API_KEY,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
