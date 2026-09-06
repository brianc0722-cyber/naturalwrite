"use client";

import { useEffect, useRef, useState } from "react";

// When PromptForge goes live, paste its address between the quotes:
const PROMPTFORGE_URL = "";

export default function AiToolkit() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div ref={rootRef} className={"nw-root" + (open ? " open" : "")}>
      <style>{`
        .nw-root, .nw-root * { box-sizing: border-box; margin: 0; padding: 0; }
        .nw-root { position: fixed; top: 24px; right: 32px; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        .nw-btn { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #d1fae5; border-radius: 999px; padding: 11px 18px; font-size: 13px; font-weight: 700; color: #065f46; cursor: pointer; box-shadow: 0 8px 22px rgba(6, 95, 70, .10); }
        .nw-btn:hover { background: #ecfdf5; }
        @media (max-width: 640px) { .nw-root { top: 16px; right: 16px; } }
        .nw-chevron { transition: transform .2s; }
        .nw-root.open .nw-chevron { transform: rotate(180deg); }
        .nw-panel { display: none; position: absolute; right: 0; top: calc(100% + 8px); width: 292px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 12px 32px rgba(0,0,0,.14); overflow: hidden; }
        .nw-root.open .nw-panel { display: block; }
        .nw-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; text-decoration: none; border-bottom: 1px solid #f1f5f9; }
        .nw-row:last-child { border-bottom: none; }
        a.nw-row[href]:hover { background: #f8fafc; }
        .nw-left { display: flex; align-items: center; gap: 10px; }
        .nw-icon { display: flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 9px; }
        .nw-icon-indigo { background: #eef2ff; }
        .nw-icon-green { background: #ecfdf5; }
        .nw-icon-amber { background: #fffbeb; }
        .nw-name { font-size: 13px; font-weight: 700; color: #0f172a; display: block; }
        .nw-desc { font-size: 11px; color: #64748b; display: block; margin-top: 2px; }
        .nw-badge { font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
      `}</style>

      <button type="button" className="nw-btn" onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        AI Toolkit
        <svg className="nw-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>

      <div className="nw-panel">
        {PROMPTFORGE_URL ? (
          <a className="nw-row" href={PROMPTFORGE_URL} target="_blank" rel="noopener">
            <span className="nw-left">
              <span className="nw-icon nw-icon-indigo">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 10-13h-7V2Z"/></svg>
              </span>
              <span><span className="nw-name">PromptForge</span><span className="nw-desc">Create, improve and test AI prompts.</span></span>
            </span>
            <span className="nw-badge" style={{ color: "#4338ca" }}>Open →</span>
          </a>
        ) : (
          <div className="nw-row">
            <span className="nw-left">
              <span className="nw-icon nw-icon-indigo">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 10-13h-7V2Z"/></svg>
              </span>
              <span><span className="nw-name">PromptForge</span><span className="nw-desc">Create, improve and test AI prompts.</span></span>
            </span>
            <span className="nw-badge" style={{ background: "#eef2ff", color: "#4338ca" }}>Coming soon</span>
          </div>
        )}

        <div className="nw-row">
          <span className="nw-left">
            <span className="nw-icon nw-icon-green">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </span>
            <span><span className="nw-name">NaturalWrite</span><span className="nw-desc">Clear, natural writing from your ideas.</span></span>
          </span>
          <span className="nw-badge" style={{ background: "#ecfdf5", color: "#047857" }}>You are here</span>
        </div>

        <a className="nw-row" href="https://www.contentsummarize.com/" target="_blank" rel="noopener">
          <span className="nw-left">
            <span className="nw-icon nw-icon-amber">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h9"/></svg>
            </span>
            <span><span className="nw-name">Summa</span><span className="nw-desc">Turn long content into useful summaries.</span></span>
          </span>
          <span className="nw-badge" style={{ color: "#b45309" }}>Open →</span>
        </a>
      </div>
    </div>
  );
}