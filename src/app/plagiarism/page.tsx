"use client";

import "./plagiarism.css";

import { useMemo, useState } from "react";
import type { CompareResult, ScanResult } from "@/lib/plagiarism/types";

type Tab = "web" | "compare";

const SAMPLE = `The theory of relativity, developed by Albert Einstein in the early twentieth century, transformed our understanding of space, time, and gravity. Special relativity showed that the speed of light is constant for all observers and that mass and energy are interchangeable. General relativity then described gravity as the curvature of spacetime caused by mass and energy. These ideas underpin modern GPS systems, cosmology, and much of contemporary physics.`;

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("web");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);

  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);

  async function runScan() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/plagiarism", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data as ScanResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCompare() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: left, b: right }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Compare failed");
      setCompare(data as CompareResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File, target: "main" | "left" | "right") {
    const raw = await readFile(file);
    if (target === "main") setText(raw);
    if (target === "left") setLeft(raw);
    if (target === "right") setRight(raw);
  }

  function downloadReport() {
    if (!result) return;
    const blob = new Blob([buildReport(text, result)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plagiarism-report.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">NW</div>
          <div>
            <h1>Natural Write · Originality</h1>
            <p>Plagiarism checker for the humanizer workflow</p>
          </div>
        </div>
        <div className="tabs">
          <button className={tab === "web" ? "active" : ""} onClick={() => setTab("web")}>
            Web scan
          </button>
          <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>
            Compare documents
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <h2>{tab === "web" ? "Check writing against public sources." : "See how much two drafts overlap."}</h2>
          <p className="lede">
            {tab === "web"
              ? "Exact phrases are searched on the public web, then matching pages are downloaded. Wikipedia, papers, and Archive still run. If WINSTON_API_KEY is set, Winston AI also scans a large web plagiarism index (uses credits)."
              : "Side-by-side fingerprinting uses word shingles, cosine similarity, and character n-grams. No internet required."}
          </p>
          <div className="chip-row">
            <span className="chip">Quoted web search</span>
            <span className="chip">Wikisource / Wikinews</span>
            <span className="chip">Internet Archive</span>
            <span className="chip">CORE + OpenAlex</span>
          </div>
        </div>
      </section>

      {tab === "web" ? (
        <>
          <div className="panel editor">
            <div className="editor-head">
              <span>Your text</span>
              <span>{words} words</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste an essay, blog draft, or humanized output…"
            />
            <div className="actions">
              <button className="btn primary" disabled={busy || words < 20} onClick={runScan}>
                {busy ? "Scanning…" : "Check originality"}
              </button>
              <label className="btn ghost file">
                Upload .txt / .docx
                <input
                  type="file"
                  accept=".txt,.md,.docx,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f, "main");
                  }}
                />
              </label>
              <button className="btn ghost" onClick={() => setText(SAMPLE)}>
                Load sample
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setText("");
                  setResult(null);
                  setError("");
                }}
              >
                Clear
              </button>
              {result && (
                <button className="btn ghost" onClick={downloadReport}>
                  Save report
                </button>
              )}
            </div>
            {error && <div className="error">{error}</div>}
          </div>

          {result ? (
            <div className="grid">
              <div>
                <div className="panel">
                  <div className="score-card">
                    <ScoreRing value={result.originality} />
                    <div className="metrics">
                      <div className="metric">
                        <b>{result.plagiarizedPercent}%</b>
                        <span>Flagged overlap</span>
                      </div>
                      <div className="metric">
                        <b>{result.matches.length}</b>
                        <span>Matched sentences</span>
                      </div>
                      <div className="metric">
                        <b>{result.sourcesChecked}</b>
                        <span>Sources checked</span>
                      </div>
                      <div className="metric">
                        <b>{(result.elapsedMs / 1000).toFixed(1)}s</b>
                        <span>Scan time</span>
                      </div>
                    </div>
                  </div>
                  {result.warnings.map((w) => (
                    <p key={w} className="warn">
                      {w}
                    </p>
                  ))}
                  <div className="legend">
                    <span>
                      <i style={{ background: "#f8c9c4" }} /> Exact / long copy
                    </span>
                    <span>
                      <i style={{ background: "#f6d9a8" }} /> Near copy
                    </span>
                    <span>
                      <i style={{ background: "#f1e3b8" }} /> Possible paraphrase
                    </span>
                  </div>
                </div>

                <div className="panel hl" style={{ marginTop: 16 }}>
                  <h3>Highlighted text</h3>
                  {result.highlights.map((h, i) =>
                    h.flagged ? (
                      <p key={i}>
                        <mark className={h.matchType}>{h.text}</mark>
                      </p>
                    ) : (
                      <p key={i}>{h.text}</p>
                    ),
                  )}
                </div>
              </div>

              <div className="panel list">
                <h3 style={{ padding: "16px 14px 4px" }}>Matching sources</h3>
                {result.sources.length === 0 && (
                  <div className="empty">No overlapping public sources found for the phrases we queried.</div>
                )}
                {result.sources.map((s) => (
                  <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer">
                    <div className="t">{s.title}</div>
                    <div className="meta">
                      <span>{s.provider}</span>
                      <span>{s.matchedSentences} sentence{s.matchedSentences === 1 ? "" : "s"}</span>
                      <span className="pct">{Math.round(s.similarity * 100)}% similar</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="panel empty" style={{ marginTop: 18 }}>
              Run a scan to see an originality score, highlighted passages, and source links.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="compare-grid">
            <div className="panel editor">
              <div className="editor-head">
                <span>Document A</span>
                <label className="btn ghost file" style={{ padding: "6px 12px" }}>
                  Upload
                  <input
                    type="file"
                    accept=".txt,.md,.docx,text/plain"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onFile(f, "left");
                    }}
                  />
                </label>
              </div>
              <textarea value={left} onChange={(e) => setLeft(e.target.value)} placeholder="First draft…" />
            </div>
            <div className="panel editor">
              <div className="editor-head">
                <span>Document B</span>
                <label className="btn ghost file" style={{ padding: "6px 12px" }}>
                  Upload
                  <input
                    type="file"
                    accept=".txt,.md,.docx,text/plain"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onFile(f, "right");
                    }}
                  />
                </label>
              </div>
              <textarea value={right} onChange={(e) => setRight(e.target.value)} placeholder="Second draft…" />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={busy || !left.trim() || !right.trim()} onClick={runCompare}>
              {busy ? "Comparing…" : "Compare overlap"}
            </button>
            {error && <div className="error">{error}</div>}
          </div>
          {compare && (
            <div className="grid">
              <div className="panel">
                <div className="score-card">
                  <ScoreRing value={Math.max(0, 100 - compare.similarity)} label="Distinct" />
                  <div className="metrics">
                    <div className="metric">
                      <b>{compare.similarity}%</b>
                      <span>Overall overlap</span>
                    </div>
                    <div className="metric">
                      <b>{compare.matchType}</b>
                      <span>Match class</span>
                    </div>
                    <div className="metric">
                      <b>{compare.wordCountA}</b>
                      <span>Words in A</span>
                    </div>
                    <div className="metric">
                      <b>{compare.wordCountB}</b>
                      <span>Words in B</span>
                    </div>
                  </div>
                </div>
                <div className="hl">
                  <h3>Shared 5-word phrases</h3>
                  {compare.sharedPhrases.length === 0 && <p>No long shared phrases.</p>}
                  {compare.sharedPhrases.map((p) => (
                    <p key={p}>“{p}”</p>
                  ))}
                </div>
              </div>
              <div className="panel hl">
                <h3>Document A highlights</h3>
                {compare.highlightsA.map((h, i) =>
                  h.flagged ? (
                    <p key={i}>
                      <mark className={h.matchType}>{h.text}</mark>
                    </p>
                  ) : (
                    <p key={i}>{h.text}</p>
                  ),
                )}
              </div>
            </div>
          )}
        </>
      )}

      <p className="footer">
        Scans quoted phrases on the public web, then compares your text to the actual page. Academic indexes
        are included. This is not Turnitin and cannot see private student-paper databases. For Natural Write, keep{" "}
        <code>/api/plagiarism</code> and add a “Check originality” button on the humanize result panel.
      </p>
    </div>
  );
}

function ScoreRing({ value, label = "Original" }: { value: number; label?: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const capped = Math.max(0, Math.min(100, value));
  const color = capped >= 80 ? "#157a3a" : capped >= 55 ? "#b45309" : "#b42318";
  return (
    <div className="ring" aria-label={`${label} ${capped}%`} style={{ position: "relative" }}>
      <svg viewBox="0 0 122 122">
        <circle cx="61" cy="61" r={r} fill="none" stroke="#eadfcf" strokeWidth="10" />
        <circle
          cx="61"
          cy="61"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(capped / 100) * c} ${c}`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <strong style={{ fontSize: 22 }}>{Math.round(capped)}%</strong>
        <span style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--muted)" }}>
          {label.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

async function readFile(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value;
  }
  return file.text();
}

function buildReport(text: string, result: ScanResult): string {
  const lines = [
    "Natural Write — Plagiarism report",
    `Originality: ${result.originality}%`,
    `Flagged overlap: ${result.plagiarizedPercent}%`,
    `Words: ${result.wordCount}  Sentences: ${result.sentenceCount}`,
    `Sources checked: ${result.sourcesChecked}`,
    "",
    "Sources",
    ...result.sources.map(
      (s) => `- ${s.title} (${Math.round(s.similarity * 100)}%) ${s.url}`,
    ),
    "",
    "Matched sentences",
    ...result.matches.map(
      (m) => `- [${m.matchType} ${Math.round(m.similarity * 100)}%] ${m.sentence}\n  → ${m.sourceTitle} ${m.sourceUrl}`,
    ),
    "",
    "Submitted text",
    text,
  ];
  return lines.join("\n");
}
