"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { StyleProfile } from "@/db/schema";
import { contractionLabel } from "@/lib/style-analyzer";
import { InstallButton } from "@/components/install-button";

export type SampleRow = {
  id: number;
  title: string;
  content: string;
  wordCount: number;
  source: string;
  createdAt: string | Date;
};

export type StyleRow = {
  id: number;
  name: string;
  profile: StyleProfile;
  summary: string;
  updatedAt: string | Date;
} | null;

type Props = {
  initialSamples: SampleRow[];
  initialStyle: StyleRow;
};

function formatDate(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-emerald-900/10 bg-white/70 px-3 py-2.5 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function NaturalWriteApp({ initialSamples, initialStyle }: Props) {
  const [samples, setSamples] = useState<SampleRow[]>(initialSamples);
  const [style, setStyle] = useState<StyleRow>(initialStyle);
  const [title, setTitle] = useState("");
  const [paste, setPaste] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<"upload" | "paste" | "rewrite" | "delete" | null>(
    null,
  );
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const profile = style?.profile ?? null;
  const totalWords = useMemo(
    () => samples.reduce((sum, s) => sum + (s.wordCount || 0), 0),
    [samples],
  );

  const flash = useCallback((type: "ok" | "err", text: string) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4200);
  }, []);

  async function addSample(payload: FormData | { title: string; content: string }) {
    const isForm = payload instanceof FormData;
    setBusy(isForm ? "upload" : "paste");
    try {
      const res = await fetch("/api/samples", {
        method: "POST",
        body: isForm
          ? payload
          : JSON.stringify(payload),
        headers: isForm ? undefined : { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        flash("err", data.error || "Could not save sample.");
        return;
      }
      setSamples((prev) => [data.sample, ...prev]);
      setStyle(data.style);
      setPaste("");
      setTitle("");
      flash(
        "ok",
        isForm
          ? "Writing sample uploaded. Style profile updated."
          : "Writing sample saved. Style profile updated.",
      );
    } catch {
      flash("err", "Network error while saving sample.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onFileChosen(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    if (title.trim()) fd.append("title", title.trim());
    await addSample(fd);
  }

  async function onPasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    await addSample({
      title: title.trim() || "Pasted sample",
      content: paste,
    });
  }

  async function onDelete(id: number) {
    setBusy("delete");
    try {
      const res = await fetch(`/api/samples/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        flash("err", data.error || "Could not delete sample.");
        return;
      }
      setSamples((prev) => prev.filter((s) => s.id !== id));
      setStyle(data.style);
      if (previewId === id) setPreviewId(null);
      flash("ok", "Sample removed. Style profile refreshed.");
    } catch {
      flash("err", "Network error while deleting.");
    } finally {
      setBusy(null);
    }
  }

  async function onRewrite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("rewrite");
    setNotes([]);
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash("err", data.error || "Rewrite failed.");
        return;
      }
      setOutput(data.rewritten || "");
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      if (!data.hasSamples) {
        flash(
          "ok",
          "Rewrote with general naturalization. Add samples for a closer match to your voice.",
        );
      } else {
        flash("ok", "Rewritten using your writing-style profile.");
      }
    } catch {
      flash("err", "Network error during rewrite.");
    } finally {
      setBusy(null);
    }
  }

  async function copyOutput() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      flash("ok", "Copied rewritten text.");
    } catch {
      flash("err", "Could not copy to clipboard.");
    }
  }

  const preview = samples.find((s) => s.id === previewId) ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-700/15 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            NaturalWrite
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Write like you — not like a model
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Upload writing samples so NaturalWrite can learn your voice, rhythm,
            and habits. Then rewrite any draft in a style that sounds like you.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <InstallButton />
          <div className="flex gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
                Samples
              </p>
              <p className="text-2xl font-semibold text-slate-900">
                {samples.length}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
                Words learned
              </p>
              <p className="text-2xl font-semibold text-slate-900">
                {totalWords.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </header>

      {message ? (
        <div
          className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
            message.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-6 lg:col-span-2">
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Upload writing samples
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Essays, emails, posts, journal entries — anything that sounds
                  like you. Plain text (.txt, .md) or paste.
                </p>
              </div>
            </div>

            <label className="mb-3 block text-sm font-medium text-slate-700">
              Sample title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Cover letter draft"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none ring-emerald-600/30 transition focus:border-emerald-500 focus:bg-white focus:ring-4"
              />
            </label>

            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0] ?? null;
                void onFileChosen(file);
              }}
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
                dragOver
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-slate-200 bg-slate-50/80 hover:border-emerald-400 hover:bg-emerald-50/40"
              }`}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
              role="button"
              tabIndex={0}
            >
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M12 16V4m0 0 4 4m-4-4-4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M20 16.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-800">
                {busy === "upload" ? "Uploading…" : "Drop a .txt or .md file"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                or click to browse — max ~50KB of text
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.markdown,.text,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => void onFileChosen(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or paste text
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={onPasteSubmit} className="space-y-3">
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={7}
                placeholder="Paste a paragraph or two that capture how you normally write…"
                className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-emerald-600/30 transition focus:border-emerald-500 focus:bg-white focus:ring-4"
              />
              <button
                type="submit"
                disabled={busy === "paste" || paste.trim().length < 40}
                className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "paste" ? "Saving…" : "Save writing sample"}
              </button>
            </form>
          </div>

          <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-emerald-950 to-slate-900 p-6 text-emerald-50 shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
            <h2 className="text-lg font-semibold">Your style profile</h2>
            <p className="mt-2 text-sm leading-relaxed text-emerald-100/85">
              {style?.summary ||
                "Upload samples to build a living profile of your writing voice."}
            </p>

            {profile && profile.sampleCount > 0 ? (
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <Metric
                  label="Avg sentence"
                  value={`${Math.round(profile.avgSentenceLength)} w`}
                  hint="words per sentence"
                />
                <Metric
                  label="Formality"
                  value={`${Math.round(profile.formalityScore * 100)}%`}
                  hint={
                    profile.formalityScore > 0.6
                      ? "more formal"
                      : profile.formalityScore < 0.4
                        ? "more casual"
                        : "balanced"
                  }
                />
                <Metric
                  label="Contractions"
                  value={contractionLabel(profile.contractionRate)}
                />
                <Metric
                  label="Vocabulary"
                  value={
                    profile.vocabularyRichness > 0.55
                      ? "Varied"
                      : profile.vocabularyRichness < 0.35
                        ? "Focused"
                        : "Steady"
                  }
                />
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-emerald-100/80">
                Tip: 2–5 samples of different lengths give the best read on your
                voice.
              </p>
            )}

            {profile?.toneNotes?.length ? (
              <ul className="mt-5 space-y-2">
                {profile.toneNotes.slice(0, 5).map((note) => (
                  <li
                    key={note}
                    className="flex gap-2 text-sm text-emerald-50/90"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="capitalize">{note}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {profile?.signaturePhrases?.length ? (
              <div className="mt-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-200/70">
                  Signature phrases
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.signaturePhrases.slice(0, 6).map((p) => (
                    <span
                      key={p}
                      className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs text-emerald-50"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-6 lg:col-span-3">
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Rewrite in your voice
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Paste a draft. NaturalWrite shapes it using the style learned
                  from your samples.
                </p>
              </div>
              {samples.length === 0 ? (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                  No samples yet — general mode
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                  Using your style profile
                </span>
              )}
            </div>

            <form onSubmit={onRewrite} className="space-y-4">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={9}
                placeholder="Paste AI-sounding or stiff text here…"
                className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-emerald-600/30 transition focus:border-emerald-500 focus:bg-white focus:ring-4"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy === "rewrite" || !input.trim()}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "rewrite" ? "Rewriting…" : "Rewrite with my style"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInput("");
                    setOutput("");
                    setNotes([]);
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </form>

            {output ? (
              <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-emerald-950">
                    Rewritten output
                  </h3>
                  <button
                    type="button"
                    onClick={() => void copyOutput()}
                    className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 transition hover:bg-emerald-50"
                  >
                    Copy
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {output}
                </p>
                {notes.length ? (
                  <ul className="mt-4 space-y-1.5 border-t border-emerald-100 pt-3">
                    {notes.map((n) => (
                      <li key={n} className="text-xs text-emerald-900/80">
                        • {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                Your sample library
              </h2>
              <span className="text-xs text-slate-500">
                {samples.length} saved
              </span>
            </div>

            {samples.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
                <p className="text-sm font-medium text-slate-700">
                  No writing samples yet
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Upload a file or paste text on the left to teach NaturalWrite
                  your style.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {samples.map((sample) => (
                  <li
                    key={sample.id}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-900">
                          {sample.title}
                        </h3>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          {sample.source}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                        {sample.content}
                      </p>
                      <p className="mt-1.5 text-xs text-slate-400">
                        {sample.wordCount} words · {formatDate(sample.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewId((id) =>
                            id === sample.id ? null : sample.id,
                          )
                        }
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {previewId === sample.id ? "Hide" : "View"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === "delete"}
                        onClick={() => void onDelete(sample.id)}
                        className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {preview ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {preview.title}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPreviewId(null)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Close
                  </button>
                </div>
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {preview.content}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
