"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Rendered only when the password gate is enabled (the server passes
 * `authEnabled` down), so unprotected deployments look exactly as before.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={pending}
      className="text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
