"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiOpinion, ScanSignal, ScanStyleMatch } from "@/db/schema";
import { DETECTOR_DISCLAIMER } from "@/lib/ai-detector";
import { SCORE_HIGH, SCORE_LOW } from "@/lib/score-bands";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
} from "@/lib/upload-limits";

type ScanRow = {
  id: number;
  /** Unguessable id used in API URLs; the serial id stays internal. */
  publicId: string;
  fileName: string;
  wordCount: number;
  score: number;
  verdict: string;
  signals: ScanSignal[];
  styleMatch: ScanStyleMatch;
  createdAt: string | Date;
};

type Detection = {
  score: number;
  verdict: string;
  confidence: "low" | "medium" | "high";
  wordCount: number;
  signals: ScanSignal[];
  styleMatch: ScanStyleMatch;
  aiOpinion: AiOpinion;
};

function scoreColor(score: number) {
  if (score < SCORE_LOW) return "#059669";
  if (score < SCORE_HIGH) return "#d97706";
  return "#e11d48";
}

function scoreLabel(score: number) {
  if (score < SCORE_LOW) return "Original";
  if (score < SCORE_HIGH) return "Mixed";
  return "AI-likely";
}

function Gauge({ score }: { score: number }) {
  const C = 2 * Math.PI * 52;
  const color = scoreColor(score);
  return (
    <div className="relative h-36 w-36">
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
          AI score
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

export function AiScanner({ hasProfile }: { hasProfile: boolean }) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [paste, setPaste] = useState("");
  const [name, setName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ detection: Detection; fileName: string } | null>(null);
  const [history, setHistory] = useState<ScanRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Aborted on unmount so a scan or history load that is still in flight when
  // the user navigates away does not resolve into an unmounted component.
  const inFlight = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/scan", { signal });
      const data = await res.json();
      if (res.ok) setHistory(Array.isArray(data.scans) ? data.scans : []);
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

  async function runScan(fd: FormData) {
    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        body: fd,
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "The scan failed.");
        return;
      }
      setResult({ detection: data.detection, fileName: data.scan.fileName });
      setPaste("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      // Awaited so the refresh is covered by the same abort controller and
      // the result and its history row appear together.
      await loadHistory(ac.signal);
    } catch (err) {
      // An abort is the user's own doing - leaving, or starting a new scan.
      if ((err as Error)?.name === "AbortError") return;
      setError("Network error while scanning.");
    } finally {
      if (inFlight.current === ac) {
        inFlight.current = null;
        setScanning(false);
      }
    }
  }

  function onPick(f: File | null) {
    if (!f) return;
    // Checked here as well as on the server: on Vercel a body over 4.5 MB is
    // rejected by the platform before the route runs, which surfaces as an
    // opaque 413 with no JSON body. Catching it client-side gives a real
    // message instantly instead of after a long upload that cannot succeed.
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

  async function submitScan() {
    const fd = new FormData();
    if (mode === "file") {
      if (!file) {
        setError("Choose a document first.");
        return;
      }
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
    } else {
      if (paste.trim().length < 120) {
        setError("Paste at least a solid paragraph (120+ characters).");
        return;
      }
      fd.append("content", paste);
      fd.append("name", name.trim() || "Pasted text");
    }
    await runScan(fd);
  }

  async function onDelete(publicId: string) {
    const res = await fetch(`/api/scan/${publicId}`, { method: "DELETE" });
    // Only drop the row locally if the server actually deleted it.
    if (!res.ok) return;
    setHistory((prev) => prev.filter((s) => s.publicId !== publicId));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="space-y-6 lg:col-span-3">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                AI content scanner
              </h2>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Upload any document or paste text. NaturalWrite scans it for
                AI fingerprints and checks it against your own writing style to
                confirm your work is original.
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(["file", "paste"] as const).map((m) => (
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
                  {m === "file" ? "Upload document" : "Paste text"}
                </button>
              ))}
            </div>
          </div>

          <label className="mb-3 block text-sm font-medium text-slate-700">
            Document name (optional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal statement draft"
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none ring-rose-600/20 transition focus:border-rose-400 focus:bg-white focus:ring-4"
            />
          </label>

          {mode === "file" ? (
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
                  ? "border-rose-400 bg-rose-50"
                  : "border-slate-200 bg-slate-50/80 hover:border-rose-300 hover:bg-rose-50/40"
              }`}
            >
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
                  <path d="M14 3v5h5M9.5 13h5M9.5 16.5h5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-800">
                {file ? file.name : "Drop any document here"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                .txt · .md · .docx · .pdf · .html · .rtf · and more — max{" "}
                {MAX_UPLOAD_LABEL}
              </p>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={9}
              placeholder="Paste the writing you want to verify as original…"
              className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-rose-600/20 transition focus:border-rose-400 focus:bg-white focus:ring-4"
            />
          )}

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            disabled={scanning}
            onClick={() => void submitScan()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.2-8.56" strokeLinecap="round" />
                </svg>
                Scanning…
              </>
            ) : (
              "Scan for AI content"
            )}
          </button>

          {!hasProfile ? (
            <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
              Tip: upload writing samples in the “Write & Rewrite” tab — scans
              get sharper when we can compare against your own voice.
            </p>
          ) : null}
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
                    {scoreLabel(result.detection.score)}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {result.detection.verdict}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {result.fileName} · {result.detection.wordCount.toLocaleString()} words
                  {result.detection.confidence === "low"
                    ? " · short text — treat as a rough estimate"
                    : result.detection.confidence === "medium"
                      ? " · medium confidence"
                      : " · high confidence"}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {DETECTOR_DISCLAIMER}
                </p>
                {result.detection.styleMatch ? (
                  <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
                    {result.detection.styleMatch.note}
                  </p>
                ) : null}
              </div>
            </div>

            {result.detection.aiOpinion ? (
              <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
                  </svg>
                  <h3 className="text-sm font-semibold text-indigo-950">
                    Generative AI second opinion
                  </h3>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                    {result.detection.aiOpinion.model}
                  </span>
                  <span className="ml-auto text-sm font-bold text-indigo-900">
                    {result.detection.aiOpinion.score}/100 · {result.detection.aiOpinion.verdict}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-indigo-950/80">
                  {result.detection.aiOpinion.reasoning}
                </p>
                {result.detection.aiOpinion.flags.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {result.detection.aiOpinion.flags.map((f, i) => (
                      <li
                        key={`${i}-${f}`}
                        className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs text-indigo-900"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500 ring-1 ring-slate-200">
                Heuristic-only scan. To add a generative-AI second opinion, set an{" "}
                <code className="rounded bg-slate-200 px-1 py-0.5 text-[11px] text-slate-700">
                  OPENAI_API_KEY
                </code>{" "}
                environment variable in your hosting settings — your text is
                never sent anywhere otherwise.
              </p>
            )}

            <ul className="mt-6 space-y-4 border-t border-slate-100 pt-5">
              {result.detection.signals.map((s, i) => (
                <li key={`${i}-${s.label}`} className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      s.points > 0 ? "bg-rose-500" : "bg-emerald-500"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{s.label}</p>
                      <span
                        className={`text-xs font-bold ${
                          s.points > 0 ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {s.points > 0 ? `+${s.points}` : s.points}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                      {s.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="lg:col-span-2">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Scan history</h2>
            <span className="text-xs text-slate-500">{history.length} saved</span>
          </div>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">No scans yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Your scanned documents and their originality scores will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.map((h) => (
                <li key={h.publicId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                    style={{ backgroundColor: scoreColor(h.score) }}
                  >
                    {h.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {h.fileName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {h.verdict} · {h.wordCount.toLocaleString()} words · {fmtDate(h.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDelete(h.publicId)}
                    className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 transition hover:border-rose-200 hover:text-rose-700"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">How the scan works</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600">
              <li>• Flags stock AI phrases, formulaic transitions, and hedging</li>
              <li>• Measures sentence-rhythm uniformity (AI rarely varies pace)</li>
              <li>• Checks for contractions, personal voice, and concrete details</li>
              <li>• Compares the text against your uploaded writing samples</li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              {DETECTOR_DISCLAIMER}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
