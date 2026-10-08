"use client";

import { useEffect, useId, useRef, useState } from "react";

/** PromptForge's live address. Leave empty to show "Coming soon" instead. */
const PROMPTFORGE_URL = "https://promptforge-omega-navy.vercel.app";

const SUMMA_URL = "https://www.contentsummarize.com/";

export default function AiToolkit() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Close on outside click and on Escape; return focus to the button on Escape
  // so keyboard users are never stranded.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const promptForgeLive = PROMPTFORGE_URL.trim().length > 0;

  return (
    <div ref={rootRef} className={"nw-root" + (open ? " open" : "")}>
      <style>{`
        .nw-root, .nw-root * { box-sizing: border-box; margin: 0; padding: 0; }
        .nw-root { position: fixed; top: 24px; right: 32px; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        .nw-btn { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #d1fae5; border-radius: 999px; padding: 11px 18px; font-size: 13px; font-weight: 700; color: #065f46; cursor: pointer; box-shadow: 0 8px 22px rgba(6, 95, 70, .10); transition: background .15s, box-shadow .15s; }
        .nw-btn:hover { background: #ecfdf5; }
        .nw-btn:focus-visible { outline: 2px solid #059669; outline-offset: 2px; }
        @media (max-width: 640px) { .nw-root { top: 16px; right: 16px; } .nw-panel { width: min(292px, calc(100vw - 32px)); } }
        .nw-chevron { transition: transform .2s; }
        .nw-root.open .nw-chevron { transform: rotate(180deg); }
        .nw-panel { display: none; position: absolute; right: 0; top: calc(100% + 10px); width: 292px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 12px 32px rgba(0,0,0,.14); overflow: hidden; }
        .nw-root.open .nw-panel { display: block; }
        .nw-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; text-decoration: none; color: inherit; border-bottom: 1px solid #f1f5f9; }
        .nw-row:last-child { border-bottom: none; }
        a.nw-row:hover { background: #f8fafc; }
        a.nw-row:focus-visible { outline: 2px solid #059669; outline-offset: -2px; background: #f8fafc; }
        .nw-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .nw-icon { display: flex; flex-shrink: 0; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 9px; }
        .nw-icon-indigo { background: #eef2ff; }
        .nw-icon-green { background: #ecfdf5; }
        .nw-icon-amber { background: #fffbeb; }
        .nw-name { font-size: 13px; font-weight: 700; color: #0f172a; display: block; }
        .nw-desc { font-size: 11px; color: #64748b; display: block; margin-top: 2px; line-height: 1.4; }
        .nw-badge { flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
        .nw-badge-open-indigo { color: #4338ca; }
        .nw-badge-soon { background: #eef2ff; color: #4338ca; }
        .nw-badge-here { background: #ecfdf5; color: #047857; }
        .nw-badge-open-amber { color: #b45309; }
      `}</style>

      <button
        ref={buttonRef}
        type="button"
        className="nw-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        AI Toolkit
        <svg className="nw-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div id={panelId} className="nw-panel" role="menu" aria-label="AI Toolkit apps">
        {promptForgeLive ? (
          <a className="nw-row" role="menuitem" href={PROMPTFORGE_URL} target="_blank" rel="noopener noreferrer">
            <span className="nw-left">
              <span className="nw-icon nw-icon-indigo">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 2 4 14h7l-1 8 10-13h-7V2Z" />
                </svg>
              </span>
              <span>
                <span className="nw-name">PromptForge</span>
                <span className="nw-desc">Create, improve and test AI prompts.</span>
              </span>
            </span>
            <span className="nw-badge nw-badge-open-indigo">Open →</span>
          </a>
        ) : (
          <div className="nw-row" role="menuitem" aria-disabled="true">
            <span className="nw-left">
              <span className="nw-icon nw-icon-indigo">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 2 4 14h7l-1 8 10-13h-7V2Z" />
                </svg>
              </span>
              <span>
                <span className="nw-name">PromptForge</span>
                <span className="nw-desc">Create, improve and test AI prompts.</span>
              </span>
            </span>
            <span className="nw-badge nw-badge-soon">Coming soon</span>
          </div>
        )}

        <div className="nw-row" role="menuitem" aria-current="page">
          <span className="nw-left">
            <span className="nw-icon nw-icon-green">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </span>
            <span>
              <span className="nw-name">NaturalWrite</span>
              <span className="nw-desc">Clear, natural writing from your ideas.</span>
            </span>
          </span>
          <span className="nw-badge nw-badge-here">You are here</span>
        </div>

        <a className="nw-row" role="menuitem" href={SUMMA_URL} target="_blank" rel="noopener noreferrer">
          <span className="nw-left">
            <span className="nw-icon nw-icon-amber">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 6h13M8 12h13M8 18h9" />
              </svg>
            </span>
            <span>
              <span className="nw-name">Summa</span>
              <span className="nw-desc">Turn long content into useful summaries.</span>
            </span>
          </span>
          <span className="nw-badge nw-badge-open-amber">Open →</span>
        </a>
      </div>
    </div>
  );
}