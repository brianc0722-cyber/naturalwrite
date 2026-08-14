"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GrammarIssueRow, GrammarStatsRow } from "@/db/schema";
import {
  GRAMMAR_CLEAN,
  GRAMMAR_FAIR,
  GRAMMAR_DISCLAIMER,
} from "@/lib/grammar";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
} from "@/lib/upload-limits";

type CheckRow = {
  id: number;
  publicId: string;
  fileName: string;
  wordCount: number;
  score: number;
  verdict: string;
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
  source: string;
  createdAt: string | Date;
};

type Detection = {
  score: number;
  verdict: string;
  issues: GrammarIssueRow[];
  counts: {
    error: number;
    warning: number;
    suggestion: number;
    grammar: number;
    mechanics: number;
    style: number;
  };
  stats: GrammarStatsRow;
  llmModel: string | null;
  llmTruncated: boolean;
};

/** Green when clean, amber when fair, rose when the text needs real work. */
function scoreColor(score: number) {
  if (score >= GRAMMAR_CLEAN) return "#059669";
  if (score >= GRAMMAR_FAIR) return "#d97706";
  return "#e11d48";
}

const SEVERITY_STYLE: Record<
  string,
  { dot: string; chip: string; label: string }
> = {
  error: {
    dot: "#e11d48",
    chip: "bg-rose-50 text-rose-800 ring-rose-200",
    label: "Error",
  },
  warning: {
    dot: "#d97706",
    chip: "bg-amber-50 text-amber-900 ring-amber-200",
    label: "Warning",
  },
  suggestion: {
    dot: "#0284c7",
    chip: "bg-sky-50 text-sky-800 ring-sky-200",
    label: "Suggestion",
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  grammar: "Grammar",
  mechanics: "Mechanics",
  style: "Style",
};

function Gauge({ score }: { score: number }) {
  const C = 2 * Math.PI * 52;
  const color = scoreColor(score);
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="11" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={color}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - score / 100)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
          Writing score
        </span>
      </div>
    </div>
  );
}

function fmtDate(v: string | Date) {
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Renders the text with every issue span highlighted.
 *
 * Issues arrive sorted by offset and non-overlapping (the route dedupes and
 * merges), so a single left-to-right pass is enough. Anything out of order or
 * overlapping is skipped rather than allowed to corrupt the output.
 */
function Highlighted({
  text,
  issues,
  activeIndex,
  onSelect,
}: {
  text: string;
  issues: GrammarIssueRow[];
  activeIndex: number | null;
  onSelect: (i: number) => void;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  issues.forEach((issue, i) => {
    if (issue.offset < cursor) return;
    if (issue.offset > text.length) return;
    if (issue.offset > cursor) {
      parts.push(<span key={`t${i}`}>{text.slice(cursor, issue.offset)}</span>);
    }
    const end = Math.min(issue.offset + issue.length, text.length);
    const style = SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.suggestion;
    const isActive = activeIndex === i;
    parts.push(
      <mark
        key={`m${i}`}
        onClick={() => onSelect(i)}
        title={issue.message}
        className={`cursor-pointer rounded px-0.5 transition ${
          isActive ? "ring-2 ring-offset-1" : ""
        }`}
        style={{
          backgroundColor: `${style.dot}22`,
          boxShadow: `inset 0 -2px 0 ${style.dot}`,
          color: "inherit",
        }}
      >
        {text.slice(issue.offset, end)}
      </mark>,
    );
    cursor = end;
  });

  if (cursor < text.length) {
    parts.push(<span key="tail">{text.slice(cursor)}</span>);
  }

  return (
    <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
      {parts}
    </div>
  );
}

export function GrammarChecker({
  initialText,
  initialSource,
  onConsumed,
}: {
  /** Text handed over from the rewrite tab, if any. */
  initialText?: string | null;
  initialSource?: "rewrite" | null;
  onConsumed?: () => void;
}) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [file, setFile] = useState<File | null>(null);
  const [paste, setPaste] = useState("");
  const [name, setName] = useState("");
  const [checking, setChecking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { detection: Detection; fileName: string; text: string } | null
  >(null);
  const [history, setHistory] = useState<CheckRow[]>([]);
  const [filter, setFilter] = useState<"all" | "grammar" | "mechanics" | "style">("all");
  const [active, setActive] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/grammar", { signal });
      const data = await res.json();
      if (res.ok) setHistory(Array.isArray(data.checks) ? data.checks : []);
    } catch {
      /* ignored: aborted, offline, or malformed - history is non-essential */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadHistory(ac.signal);
    return () => ac.abort();
  }, [loadHistory]);

  useEffect(() => {
    return () => inFlight.current?.abort();
  }, []);

  /** Text arriving from the rewrite tab lands in the box, ready to check. */
  useEffect(() => {
    if (!initialText) return;
    setMode("paste");
    setPaste(initialText);
    setName((n) => n || "Rewritten text");
    setResult(null);
    setError(null);
    onConsumed?.();
  }, [initialText, onConsumed]);

  const runCheck = useCallback(
    async (body: BodyInit, isForm: boolean, sourceText: string) => {
      inFlight.current?.abort();
      const ac = new AbortController();
      inFlight.current = ac;
      setChecking(true);
      setError(null);
      try {
        const res = await fetch("/api/grammar", {
          method: "POST",
          body,
          headers: isForm ? undefined : { "Content-Type": "application/json" },
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "The check failed.");
          return;
        }
        setResult({
          detection: data.detection,
          fileName: data.check?.fileName ?? (name.trim() || "Pasted text"),
          // Uploads are extracted server-side, so the client has no copy of
          // the text to highlight. Fall back to what we sent.
          text: sourceText,
        });
        setActive(null);
        await loadHistory(ac.signal);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError("Network error while checking.");
      } finally {
        if (inFlight.current === ac) {
          inFlight.current = null;
          setChecking(false);
        }
      }
    },
    [loadHistory, name],
  );

  function onPick(f: File | null) {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setError(
        `That file is ${formatBytes(f.size)}. Keep documents under ${MAX_UPLOAD_LABEL}.`,
      );
      return;
    }
    setError(null);
    setFile(f);
    if (!name.trim()) setName(f.name);
  }

  async function submit() {
    if (mode === "file") {
      if (!file) {
        setError("Choose a document first.");
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      // The server extracts the text; we cannot highlight what we never read,
      // so the highlighted view is skipped for uploads and the issue list
      // carries its own excerpt and context instead.
      await runCheck(fd, true, "");
      return;
    }
    if (paste.trim().length < 40) {
      setError("Paste at least a sentence or two (40+ characters).");
      return;
    }
    const text = paste;
    await runCheck(
      JSON.stringify({
        text,
        name: name.trim() || "Pasted text",
        source: initialSource ?? undefined,
      }),
      false,
      text,
    );
  }

  async function onDelete(publicId: string) {
    const res = await fetch(`/api/grammar/${publicId}`, { method: "DELETE" });
    if (!res.ok) return;
    setHistory((prev) => prev.filter((c) => c.publicId !== publicId));
  }

  const visibleIssues = useMemo(() => {
    if (!result) return [];
    return filter === "all"
      ? result.detection.issues
      : result.detection.issues.filter((i) => i.category === filter);
  }, [result, filter]);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="space-y-6 lg:col-span-3">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Grammar &amp; mechanics
              </h2>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Checks spelling mechanics, punctuation, agreement and clarity —
                on text you paste, a document you upload, or anything you just
                rewrote in your own voice.
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(["paste", "file"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    mode === m
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {m === "paste" ? "Paste text" : "Upload document"}
                </button>
              ))}
            </div>
          </div>

          <label className="mb-3 block text-sm font-medium text-slate-700">
            Document name (optional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cover letter draft"
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none ring-violet-600/20 transition focus:border-violet-400 focus:bg-white focus:ring-4"
            />
          </label>

          {mode === "paste" ? (
            <>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={10}
                placeholder="Paste the writing you want checked…"
                className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-violet-600/20 transition focus:border-violet-400 focus:bg-white focus:ring-4"
              />
              <p className="mt-1.5 text-right text-xs text-slate-500">
                {paste.trim() ? `${paste.trim().length.toLocaleString()} characters` : ""}
              </p>
            </>
          ) : (
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
                onPick(e.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${
                dragOver
                  ? "border-violet-400 bg-violet-50"
                  : "border-slate-200 bg-slate-50/80 hover:border-violet-300 hover:bg-violet-50/40"
              }`}
            >
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
                  <path d="M14 3v5h5M9.5 13h5M9.5 16.5h5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-800">
                {file ? file.name : "Drop a document here"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                .txt · .md · .docx · .pdf · .html · .rtf — max {MAX_UPLOAD_LABEL}
              </p>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            disabled={checking}
            onClick={() => void submit()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.2-8.56" strokeLinecap="round" />
                </svg>
                Checking…
              </>
            ) : (
              "Check grammar & mechanics"
            )}
          </button>
        </div>

        {result ? (
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <Gauge score={result.detection.score} />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white"
                    style={{ backgroundColor: scoreColor(result.detection.score) }}
                  >
                    {result.detection.verdict}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {result.detection.issues.length === 0
                      ? "No issues found"
                      : `${result.detection.issues.length} issue${
                          result.detection.issues.length === 1 ? "" : "s"
                        }`}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {result.fileName} ·{" "}
                  {result.detection.stats.wordCount.toLocaleString()} words ·{" "}
                  {result.detection.stats.sentenceCount} sentences · avg{" "}
                  {result.detection.stats.avgSentenceLength} words/sentence
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(["error", "warning", "suggestion"] as const).map((sev) => {
                    const n = result.detection.counts[sev];
                    const s = SEVERITY_STYLE[sev];
                    return (
                      <span
                        key={sev}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${s.chip}`}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.dot }}
                        />
                        {n} {s.label.toLowerCase()}
                        {n === 1 ? "" : "s"}
                      </span>
                    );
                  })}
                </div>

                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  {GRAMMAR_DISCLAIMER}
                </p>
                <p className="mt-1.5 text-xs text-slate-500">
                  {result.detection.llmModel
                    ? `Rule checks plus an AI review (${result.detection.llmModel}).`
                    : "Spelling and rule checks only — set OPENAI_API_KEY to add an AI review that catches agreement, tense and word-choice errors."}
                  {result.detection.llmTruncated
                    ? " The AI review saw only the first part of this document."
                    : ""}
                </p>
              </div>
            </div>

            {result.detection.issues.length > 0 ? (
              <>
                <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5">
                  {(["all", "grammar", "mechanics", "style"] as const).map((f) => {
                    const n =
                      f === "all"
                        ? result.detection.issues.length
                        : result.detection.counts[f];
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          filter === f
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {f === "all" ? "All" : CATEGORY_LABEL[f]} ({n})
                      </button>
                    );
                  })}
                </div>

                <ul className="mt-4 space-y-2.5">
                  {visibleIssues.map((issue, i) => {
                    const s = SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.suggestion;
                    const idx = result.detection.issues.indexOf(issue);
                    return (
                      <li
                        key={`${issue.rule}-${issue.offset}-${i}`}
                        onClick={() => setActive(idx)}
                        className={`cursor-pointer rounded-2xl border p-3.5 transition ${
                          active === idx
                            ? "border-slate-400 bg-slate-50"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/60"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${s.chip}`}
                          >
                            {s.label}
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {CATEGORY_LABEL[issue.category] ?? issue.category}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm text-slate-800">
                          {issue.message}
                        </p>
                        {issue.excerpt ? (
                          <p className="mt-1.5 text-xs text-slate-500">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                              {issue.excerpt.length > 80
                                ? `${issue.excerpt.slice(0, 77)}…`
                                : issue.excerpt}
                            </span>
                            {issue.suggestion ? (
                              <>
                                {" → "}
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-emerald-800">
                                  {issue.suggestion.length > 80
                                    ? `${issue.suggestion.slice(0, 77)}…`
                                    : issue.suggestion}
                                </span>
                              </>
                            ) : null}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="mt-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                Nothing flagged. Remember that this is a spelling dictionary
                plus pattern rules, not a full parser — a clean result means no
                obvious problems, not a guarantee.
              </p>
            )}

            {result.text ? (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="mb-2.5 text-sm font-semibold text-slate-900">
                  Your text, marked up
                </h3>
                <Highlighted
                  text={result.text}
                  issues={result.detection.issues}
                  activeIndex={active}
                  onSelect={setActive}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-6 lg:col-span-2">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h2 className="text-lg font-semibold text-slate-900">Recent checks</h2>
          <p className="mt-1 text-sm text-slate-600">
            Your last 20 grammar checks.
          </p>

          {history.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              No checks yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {history.map((c) => (
                <li
                  key={c.publicId}
                  className="rounded-2xl border border-slate-200 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {c.fileName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {fmtDate(c.createdAt)} · {c.wordCount.toLocaleString()}{" "}
                        words
                        {c.source === "rewrite" ? " · from rewrite" : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {c.errorCount} errors · {c.warningCount} warnings ·{" "}
                        {c.suggestionCount} suggestions
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                        style={{ backgroundColor: scoreColor(c.score) }}
                      >
                        {c.score}
                      </span>
                      <button
                        type="button"
                        onClick={() => void onDelete(c.publicId)}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
