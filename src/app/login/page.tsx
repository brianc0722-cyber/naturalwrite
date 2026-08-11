import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { authEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // If the deployment isn't password-protected there is nothing to log in to.
  if (!authEnabled()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            NaturalWrite
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            This workspace is password protected.
          </p>
        </div>
        {/* LoginForm reads ?next= via useSearchParams, which requires a
            Suspense boundary so the page can still be statically prerendered. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
