import { NaturalWriteApp } from "@/components/natural-write-app";
import {
  getActiveStyleProfile,
  listSamples,
  rebuildStyleProfile,
} from "@/lib/samples";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const samples = await listSamples();
  let style = await getActiveStyleProfile();
  if (!style) {
    style = await rebuildStyleProfile();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ecfdf5_0%,_#f8fafc_45%,_#f1f5f9_100%)]">
      <NaturalWriteApp
        initialSamples={samples.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
        }))}
        initialStyle={
          style
            ? {
                ...style,
                updatedAt: style.updatedAt.toISOString(),
              }
            : null
        }
      />
    </main>
  );
}
