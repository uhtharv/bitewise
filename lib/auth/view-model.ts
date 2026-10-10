export type AuthMode = "sign-in" | "sign-up";

export const DEFAULT_AUTH_ERROR_MESSAGE =
  "Could not start Google sign-in. Please try again.";

export function resolveAuthMode(
  modeParam: string | null | undefined
): AuthMode {
  return modeParam === "sign-up" ? "sign-up" : "sign-in";
}

function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return false;
  }
  if (path === "/sign-in" || path.startsWith("/sign-in/") || path.startsWith("/sign-in?")) {
    return false;
  }
  return true;
}

export function sanitizeRedirectUrl(
  rawUrl: string | null | undefined,
  currentOrigin?: string
): string {
  if (!rawUrl) {
    return "/";
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "/";
  }

  if (isSafeInternalPath(trimmed)) {
    return trimmed;
  }

  if (currentOrigin) {
    try {
      const parsed = new URL(trimmed);
      const originUrl = new URL(currentOrigin);
      if (parsed.origin === originUrl.origin) {
        const candidate = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return isSafeInternalPath(candidate) ? candidate : "/";
      }
    } catch {
      return "/";
    }
  }

  return "/";
}

export function isSsoCallbackSegments(
  segments: string[] | undefined
): boolean {
  return Array.isArray(segments) && segments.length === 1 && segments[0] === "sso-callback";
}

export function extractClerkErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybeLong = (error as { longMessage?: unknown }).longMessage;
    if (typeof maybeLong === "string" && maybeLong.trim().length > 0) {
      return maybeLong.trim();
    }
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage.trim();
    }
  }
  return DEFAULT_AUTH_ERROR_MESSAGE;
}

