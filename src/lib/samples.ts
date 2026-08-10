import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  styleProfiles,
  writingSamples,
  type StyleProfile,
} from "@/db/schema";
import { analyzeTexts, summarizeProfile } from "@/lib/style-analyzer";

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function listSamples() {
  return db
    .select()
    .from(writingSamples)
    .orderBy(desc(writingSamples.createdAt));
}

export async function getActiveStyleProfile(): Promise<{
  id: number;
  name: string;
  profile: StyleProfile;
  summary: string;
  updatedAt: Date;
} | null> {
  const rows = await db
    .select()
    .from(styleProfiles)
    .orderBy(desc(styleProfiles.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function rebuildStyleProfile() {
  const samples = await listSamples();
  const texts = samples.map((s) => s.content);

  if (texts.length === 0) {
    const empty: StyleProfile = {
      avgSentenceLength: 16,
      avgWordLength: 4.5,
      vocabularyRichness: 0.5,
      contractionRate: 0.02,
      questionRate: 0.05,
      exclamationRate: 0.02,
      commaDensity: 0.05,
      semicolonDensity: 0,
      emDashDensity: 0,
      firstPersonRate: 0.03,
      passiveVoiceHint: 0.05,
      formalityScore: 0.5,
      commonTransitions: [],
      signaturePhrases: [],
      preferredOpeners: [],
      toneNotes: ["Upload writing samples so NaturalWrite can learn your voice"],
      sampleWordCount: 0,
      sampleCount: 0,
    };

    const existing = await getActiveStyleProfile();
    if (existing) {
      const [updated] = await db
        .update(styleProfiles)
        .set({
          profile: empty,
          summary: "No samples uploaded yet.",
          updatedAt: new Date(),
        })
        .where(eq(styleProfiles.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(styleProfiles)
      .values({
        name: "My writing style",
        profile: empty,
        summary: "No samples uploaded yet.",
      })
      .returning();
    return created;
  }

  const profile = analyzeTexts(texts);
  const summary = summarizeProfile(profile);
  const existing = await getActiveStyleProfile();

  if (existing) {
    const [updated] = await db
      .update(styleProfiles)
      .set({
        profile,
        summary,
        updatedAt: new Date(),
      })
      .where(eq(styleProfiles.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(styleProfiles)
    .values({
      name: "My writing style",
      profile,
      summary,
    })
    .returning();
  return created;
}
