import { Suspense } from "react";
import {
  AuthCardFallback,
  SignInRouteContent,
} from "@/components/auth/custom-auth-card";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-canvas-soft px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-black tracking-tight text-ink">
          Bitewise
        </h1>
        <p className="mt-2 text-base text-body">
          Type what you ate. Get calories and macros in seconds.
        </p>
      </div>

      <Suspense fallback={<AuthCardFallback />}>
        <SignInRouteContent />
      </Suspense>
    </main>
  );
}
