"use client";

import {
  HandleSSOCallback,
  useAuth,
  useSignIn,
  useSignUp,
} from "@clerk/nextjs";
import { cn } from "cn";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AuthMode,
  extractClerkErrorMessage,
  isSsoCallbackSegments,
  resolveAuthMode,
  sanitizeRedirectUrl,
} from "@/lib/auth/view-model";

export interface SsoCapableResource {
  sso: (params: {
    strategy: "oauth_google";
    redirectUrl: string;
    redirectCallbackUrl: string;
  }) => Promise<{ error: unknown | null }>;
}

export async function performGoogleOAuth(params: {
  mode: AuthMode;
  redirectUrl: string;
  signIn: SsoCapableResource | null | undefined;
  signUp: SsoCapableResource | null | undefined;
}): Promise<{ errorMessage: string | null }> {
  const target = params.mode === "sign-up" ? params.signUp : params.signIn;
  if (!target) {
    return {
      errorMessage: "Authentication is still initializing. Please try again.",
    };
  }

  try {
    const { error } = await target.sso({
      strategy: "oauth_google",
      redirectUrl: params.redirectUrl,
      redirectCallbackUrl: "/sign-in/sso-callback",
    });

    if (error) {
      return { errorMessage: extractClerkErrorMessage(error) };
    }

    return { errorMessage: null };
  } catch (err) {
    return { errorMessage: extractClerkErrorMessage(err) };
  }
}

export interface CustomAuthCardViewProps {
  mode: AuthMode;
  isSubmitting: boolean;
  errorMessage: string | null;
  onModeChange?: (mode: AuthMode) => void;
  onContinueWithGoogle?: () => void;
}

export function GoogleMarkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z"
      />
    </svg>
  );
}

export function CustomAuthCardView({
  mode,
  isSubmitting,
  errorMessage,
  onModeChange,
  onContinueWithGoogle,
}: CustomAuthCardViewProps) {
  const isSignUp = mode === "sign-up";

  return (
    <Card className="w-full max-w-md border border-border bg-canvas shadow-xs">
      <CardHeader className="gap-4 pb-2">
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-2 gap-1 rounded-xl bg-canvas-soft p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            disabled={isSubmitting}
            onClick={() => onModeChange?.("sign-in")}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25 disabled:pointer-events-none disabled:opacity-60",
              !isSignUp
                ? "bg-canvas text-ink shadow-2xs"
                : "text-body hover:text-ink"
            )}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            disabled={isSubmitting}
            onClick={() => onModeChange?.("sign-up")}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25 disabled:pointer-events-none disabled:opacity-60",
              isSignUp
                ? "bg-canvas text-ink shadow-2xs"
                : "text-body hover:text-ink"
            )}
          >
            Create account
          </button>
        </div>

        <div className="space-y-1 pt-1">
          <CardTitle className="text-2xl font-semibold tracking-tight text-ink">
            {isSignUp
              ? "Create your Bitewise account"
              : "Welcome back to Bitewise"}
          </CardTitle>
          <CardDescription className="text-sm text-body">
            {isSignUp
              ? "Sign up with your Google account to start logging meals and tracking macros."
              : "Sign in with Google to view your daily meal log and nutrition targets."}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 pt-2">
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-xl border border-negative/25 bg-negative/10 px-4 py-3 text-sm font-semibold text-negative-deep"
          >
            {errorMessage}
          </div>
        ) : null}

        <Button
          type="button"
          size="lg"
          disabled={isSubmitting}
          onClick={onContinueWithGoogle}
          className="min-h-12 w-full gap-3 rounded-xl bg-primary text-base font-semibold text-on-primary hover:bg-primary-active"
        >
          <GoogleMarkIcon />
          <span>
            {isSubmitting ? "Connecting to Google…" : "Continue with Google"}
          </span>
        </Button>

        <div id="clerk-captcha" />

        <p className="text-center text-xs text-mute">
          {isSignUp ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onModeChange?.("sign-in")}
                className="font-semibold text-ink underline underline-offset-4 hover:text-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
              >
                Sign in instead
              </button>
            </>
          ) : (
            <>
              New to Bitewise?{" "}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onModeChange?.("sign-up")}
                className="font-semibold text-ink underline underline-offset-4 hover:text-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
              >
                Create an account
              </button>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export function AuthCardFallback() {
  return (
    <Card
      role="status"
      aria-label="Loading authentication"
      className="w-full max-w-md border border-border bg-canvas shadow-xs"
    >
      <CardHeader className="gap-4 pb-2">
        <CardTitle className="sr-only">Loading authentication</CardTitle>
        <Skeleton className="h-11 w-full rounded-xl bg-canvas-soft" />
        <div className="space-y-2 pt-1">
          <Skeleton className="h-7 w-56 rounded-md bg-canvas-soft" />
          <Skeleton className="h-4 w-full rounded-md bg-canvas-soft" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-2">
        <Skeleton className="h-12 w-full rounded-xl bg-canvas-soft" />
        <Skeleton className="mx-auto h-4 w-44 rounded-md bg-canvas-soft" />
      </CardContent>
    </Card>
  );
}

export function SsoCallbackCardView({
  children,
}: {
  children?: React.ReactNode;
}) {
  return (
    <Card
      role="status"
      aria-label="Completing sign-in"
      className="w-full max-w-md border border-border bg-canvas shadow-xs"
    >
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl font-semibold tracking-tight text-ink">
          Completing sign-in…
        </CardTitle>
        <CardDescription className="text-sm text-body">
          Verifying your Google account and preparing your meal tracker.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full rounded-xl bg-canvas-soft" />
        <div id="clerk-captcha" />
        {children}
      </CardContent>
    </Card>
  );
}

export function SsoCallbackCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = sanitizeRedirectUrl(
    searchParams.get("redirect_url"),
    typeof window !== "undefined" ? window.location.origin : undefined
  );

  return (
    <SsoCallbackCardView>
      <HandleSSOCallback
        navigateToApp={({ decorateUrl }) => {
          const destination = decorateUrl(redirectUrl);
          if (destination.startsWith("http")) {
            window.location.href = destination;
            return;
          }
          router.replace(destination);
        }}
        navigateToSignIn={() => {
          router.replace("/sign-in");
        }}
        navigateToSignUp={() => {
          router.replace("/sign-in?mode=sign-up");
        }}
      />
    </SsoCallbackCardView>
  );
}

export function CustomAuthCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { signIn, errors: signInErrors, fetchStatus: signInStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpStatus } = useSignUp();

  const queryMode = resolveAuthMode(searchParams.get("mode"));
  const [selectedMode, setSelectedMode] = useState<AuthMode | null>(null);
  const mode: AuthMode = selectedMode ?? queryMode;
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const redirectUrl = sanitizeRedirectUrl(
    searchParams.get("redirect_url"),
    typeof window !== "undefined" ? window.location.origin : undefined
  );

  useEffect(() => {
    if (isAuthLoaded && isSignedIn) {
      router.replace(redirectUrl);
    }
  }, [isAuthLoaded, isSignedIn, redirectUrl, router]);

  if (!isAuthLoaded) {
    return <AuthCardFallback />;
  }

  const activeErrors = mode === "sign-up" ? signUpErrors : signInErrors;
  const globalHookError = activeErrors?.global?.[0];
  const displayedError =
    localError ??
    (globalHookError ? extractClerkErrorMessage(globalHookError) : null);

  const isFetching =
    signInStatus === "fetching" ||
    signUpStatus === "fetching" ||
    isRedirecting;

  const handleModeChange = (nextMode: AuthMode) => {
    setSelectedMode(nextMode);
    setLocalError(null);
  };

  const handleContinueWithGoogle = async () => {
    setLocalError(null);
    setIsRedirecting(true);
    const { errorMessage } = await performGoogleOAuth({
      mode,
      redirectUrl,
      signIn,
      signUp,
    });
    if (errorMessage) {
      setIsRedirecting(false);
      setLocalError(errorMessage);
    }
  };

  return (
    <CustomAuthCardView
      mode={mode}
      isSubmitting={isFetching}
      errorMessage={displayedError}
      onModeChange={handleModeChange}
      onContinueWithGoogle={handleContinueWithGoogle}
    />
  );
}

export function SignInRouteContent() {
  const params = useParams<{ "sign-in"?: string | string[] }>();
  const rawSegments = params?.["sign-in"];
  const segments = Array.isArray(rawSegments)
    ? rawSegments
    : typeof rawSegments === "string"
      ? [rawSegments]
      : undefined;

  if (isSsoCallbackSegments(segments)) {
    return <SsoCallbackCard />;
  }

  return <CustomAuthCard />;
}
