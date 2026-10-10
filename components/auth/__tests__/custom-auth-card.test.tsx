import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AuthCardFallback,
  CustomAuthCardView,
  performGoogleOAuth,
  SsoCallbackCardView,
} from "@/components/auth/custom-auth-card";
import {
  extractClerkErrorMessage,
  isSsoCallbackSegments,
  resolveAuthMode,
  sanitizeRedirectUrl,
} from "@/lib/auth/view-model";

describe("01 — Custom Bitewise Sign-In / Sign-Up Card & Redirect View-Model", () => {
  it("resolveAuthMode defaults to 'sign-in' and returns 'sign-up' when mode=sign-up", () => {
    expect(resolveAuthMode(null)).toBe("sign-in");
    expect(resolveAuthMode(undefined)).toBe("sign-in");
    expect(resolveAuthMode("")).toBe("sign-in");
    expect(resolveAuthMode("sign-in")).toBe("sign-in");
    expect(resolveAuthMode("other")).toBe("sign-in");
    expect(resolveAuthMode("sign-up")).toBe("sign-up");
  });

  it("sanitizeRedirectUrl allows valid internal paths and blocks external, protocol-relative, or /sign-in loop URLs", () => {
    expect(sanitizeRedirectUrl(null)).toBe("/");
    expect(sanitizeRedirectUrl(undefined)).toBe("/");
    expect(sanitizeRedirectUrl("")).toBe("/");
    expect(sanitizeRedirectUrl("/")).toBe("/");
    expect(sanitizeRedirectUrl("/today")).toBe("/today");
    expect(sanitizeRedirectUrl("/settings?tab=goals")).toBe(
      "/settings?tab=goals"
    );

    // Same-origin full URL extracts pathname + search
    expect(
      sanitizeRedirectUrl(
        "http://localhost:3000/today?from=redirect",
        "http://localhost:3000"
      )
    ).toBe("/today?from=redirect");

    // Blocks external URLs, protocol-relative URLs, and /sign-in loops
    expect(
      sanitizeRedirectUrl("https://evil.example.com/phish", "http://localhost:3000")
    ).toBe("/");
    expect(sanitizeRedirectUrl("//evil.example.com/phish")).toBe("/");
    expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
    expect(sanitizeRedirectUrl("/sign-in")).toBe("/");
    expect(sanitizeRedirectUrl("/sign-in/sso-callback")).toBe("/");
  });

  it("isSsoCallbackSegments detects ['sso-callback'] and extractClerkErrorMessage returns safe user copy", () => {
    expect(isSsoCallbackSegments(undefined)).toBe(false);
    expect(isSsoCallbackSegments([])).toBe(false);
    expect(isSsoCallbackSegments(["sign-up"])).toBe(false);
    expect(isSsoCallbackSegments(["sso-callback"])).toBe(true);

    expect(extractClerkErrorMessage(null)).toBe(
      "Could not start Google sign-in. Please try again."
    );
    expect(
      extractClerkErrorMessage({
        longMessage: "Google OAuth popup was closed before completing.",
      })
    ).toBe("Google OAuth popup was closed before completing.");
    expect(
      extractClerkErrorMessage({
        message: "Session already exists",
      })
    ).toBe("Session already exists");
  });

  it("CustomAuthCardView renders accessible Sign in / Create account tabs, Continue with Google CTA, loading state, error alert, and #clerk-captcha", () => {
    const signInHtml = renderToStaticMarkup(
      <CustomAuthCardView
        mode="sign-in"
        isSubmitting={false}
        errorMessage={null}
      />
    );

    expect(signInHtml).toContain("Bitewise");
    expect(signInHtml).toContain('role="tablist"');
    expect(signInHtml).toContain('aria-selected="true"');
    expect(signInHtml).toContain("Sign in");
    expect(signInHtml).toContain("Create account");
    expect(signInHtml).toContain("Continue with Google");
    expect(signInHtml).toContain('id="clerk-captcha"');

    const signUpErrorHtml = renderToStaticMarkup(
      <CustomAuthCardView
        mode="sign-up"
        isSubmitting={true}
        errorMessage="Could not start Google sign-in. Please try again."
      />
    );

    expect(signUpErrorHtml).toContain("Create your Bitewise account");
    expect(signUpErrorHtml).toContain("Connecting to Google…");
    expect(signUpErrorHtml).toContain('role="alert"');
    expect(signUpErrorHtml).toContain(
      "Could not start Google sign-in. Please try again."
    );

    const fallbackHtml = renderToStaticMarkup(<AuthCardFallback />);
    expect(fallbackHtml).toContain('aria-label="Loading authentication"');

    const ssoHtml = renderToStaticMarkup(<SsoCallbackCardView />);
    expect(ssoHtml).toContain('aria-label="Completing sign-in"');
    expect(ssoHtml).toContain("Completing sign-in…");
    expect(ssoHtml).toContain('id="clerk-captcha"');
  });

  it("performGoogleOAuth delegates to signIn.sso in sign-in mode and signUp.sso in sign-up mode", async () => {
    const mockSignInSso = vi.fn().mockResolvedValue({ error: null });
    const mockSignUpSso = vi.fn().mockResolvedValue({ error: null });

    const signInRes = await performGoogleOAuth({
      mode: "sign-in",
      redirectUrl: "/today",
      signIn: { sso: mockSignInSso },
      signUp: { sso: mockSignUpSso },
    });

    expect(signInRes).toEqual({ errorMessage: null });
    expect(mockSignInSso).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: "/today",
      redirectCallbackUrl: "/sign-in/sso-callback",
    });
    expect(mockSignUpSso).not.toHaveBeenCalled();

    const signUpRes = await performGoogleOAuth({
      mode: "sign-up",
      redirectUrl: "/",
      signIn: { sso: mockSignInSso },
      signUp: { sso: mockSignUpSso },
    });

    expect(signUpRes).toEqual({ errorMessage: null });
    expect(mockSignUpSso).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-in/sso-callback",
    });
  });
});

