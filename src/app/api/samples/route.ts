import { NextResponse } from "next/server";
import { db } from "@/db";
import { writingSamples } from "@/db/schema";
import { countWords, listSamples, rebuildStyleProfile } from "@/lib/samples";

export const dynamic = "force-dynamic";

const MAX_CONTENT = 50_000;
const MAX_SAMPLES = 40;

export async function GET() {
  const samples = await listSamples();
  return NextResponse.json({ samples });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let title = "Untitled sample";
    let content = "";
    let source = "paste";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const titleField = form.get("title");
      const contentField = form.get("content");

      if (typeof titleField === "string" && titleField.trim()) {
        title = titleField.trim().slice(0, 200);
      }

      if (file instanceof File) {
        source = "upload";
        const name = file.name || "upload.txt";
        if (!title || title === "Untitled sample") {
          title = name.replace(/\.[^.]+$/, "").slice(0, 200) || "Uploaded sample";
        }

        const lower = name.toLowerCase();
        if (
          !lower.endsWith(".txt") &&
          !lower.endsWith(".md") &&
          !lower.endsWith(".markdown") &&
          !lower.endsWith(".text") &&
          file.type &&
          !file.type.startsWith("text/")
        ) {
          return NextResponse.json(
            {
              error:
                "Please upload a plain text file (.txt or .md). PDF/DOCX are not supported yet.",
            },
            { status: 400 },
          );
        }

        if (file.size > MAX_CONTENT * 2) {
          return NextResponse.json(
            { error: "File is too large. Keep samples under ~50KB of text." },
            { status: 400 },
          );
        }

        content = (await file.text()).replace(/\u0000/g, "").trim();
      } else if (typeof contentField === "string") {
        content = contentField.trim();
        source = "paste";
      }
    } else {
      const body = (await request.json()) as {
        title?: string;
        content?: string;
        source?: string;
      };
      title = (body.title?.trim() || "Untitled sample").slice(0, 200);
      content = (body.content ?? "").trim();
      source = body.source === "upload" ? "upload" : "paste";
    }

    if (!content || content.length < 40) {
      return NextResponse.json(
        {
          error:
            "Sample is too short. Paste or upload at least a short paragraph (40+ characters) so we can learn your style.",
        },
        { status: 400 },
      );
    }

    if (content.length > MAX_CONTENT) {
      content = content.slice(0, MAX_CONTENT);
    }

    const existing = await listSamples();
    if (existing.length >= MAX_SAMPLES) {
      return NextResponse.json(
        {
          error: `You can store up to ${MAX_SAMPLES} samples. Delete one before adding another.`,
        },
        { status: 400 },
      );
    }

    const wordCount = countWords(content);
    const [sample] = await db
      .insert(writingSamples)
      .values({
        title,
        content,
        wordCount,
        source,
      })
      .returning();

    const style = await rebuildStyleProfile();

    return NextResponse.json({ sample, style }, { status: 201 });
  } catch (err) {
    console.error("POST /api/samples", err);
    return NextResponse.json(
      { error: "Could not save writing sample." },
      { status: 500 },
    );
  }
}
