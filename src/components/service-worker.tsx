"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on mount.
 *
 * Without a registered service worker that has a `fetch` handler, Chromium
 * never fires `beforeinstallprompt`, so <InstallButton /> can only ever show
 * its manual-instructions fallback. This is the piece that makes the PWA
 * install flow real.
 *
 * Registration is deliberately skipped in development: the dev server serves
 * uncompiled, frequently-changing assets, and a caching worker there produces
 * confusing stale-content bugs during local work.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration must never break the app; the install button
        // simply falls back to manual instructions, exactly as before.
      });
    };

    // Wait for load so the worker never competes with the first paint.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
