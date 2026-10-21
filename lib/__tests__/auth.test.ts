import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return {
    ...actual,
    auth: () => mockAuth(),
  };
});

describe("03 — Clerk Google Authentication, Route Protection & /sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requireAuth() returns a 401 JSON response when no auth is present", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    const { requireAuth } = await import("@/lib/auth");

    const result = await requireAuth();

    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
      const body = (await result.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("requireAuth() returns a valid userId string when auth is present", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "user_abc123" });
    const { requireAuth } = await import("@/lib/auth");

    const result = await requireAuth();

    expect(result).toBe("user_abc123");
  });

  it("middleware redirects unauthenticated users on protected routes to /sign-in and allows /sign-in", async () => {
    const { handleMiddlewareAuth } = await import("@/middleware");
    const mockRedirectToSignIn = vi.fn(
      ({ returnBackUrl }: { returnBackUrl?: string }) =>
        Response.redirect(
          `https://example.com/sign-in?redirect_url=${encodeURIComponent(returnBackUrl ?? "")}`,
          307
        )
    );

    const unauthMiddlewareAuth = Object.assign(
      async () => ({
        userId: null,
        redirectToSignIn: mockRedirectToSignIn,
      }),
      { protect: vi.fn() }
    );

    const homeReq = new NextRequest("https://example.com/");
    const homeRes = await handleMiddlewareAuth(
      // Intentional partial mock of ClerkMiddlewareAuth for unit testing route protection
      unauthMiddlewareAuth as unknown as Parameters<
        typeof handleMiddlewareAuth
      >[0],
      homeReq
    );

    expect(mockRedirectToSignIn).not.toHaveBeenCalled();
    expect(homeRes?.status).toBe(200);

    mockRedirectToSignIn.mockClear();
    const todayReq = new NextRequest("https://example.com/today");
    const todayRes = await handleMiddlewareAuth(
      unauthMiddlewareAuth as unknown as Parameters<
        typeof handleMiddlewareAuth
      >[0],
      todayReq
    );

    expect(mockRedirectToSignIn).toHaveBeenCalledWith({
      returnBackUrl: "https://example.com/today",
    });
    expect(todayRes?.status).toBe(307);

    mockRedirectToSignIn.mockClear();
    const signInReq = new NextRequest("https://example.com/sign-in");
    const signInRes = await handleMiddlewareAuth(
      unauthMiddlewareAuth as unknown as Parameters<
        typeof handleMiddlewareAuth
      >[0],
      signInReq
    );

    expect(mockRedirectToSignIn).not.toHaveBeenCalled();
    expect(signInRes?.status).toBe(200);
  });

  it("matches /__clerk/*.js assets in middleware config.matcher, allows /__clerk in handleMiddlewareAuth, and enables frontendApiProxy for /__clerk paths on custom domains", async () => {
    const {
      config,
      handleMiddlewareAuth,
      shouldEnableFrontendApiProxy,
    } = await import("@/middleware");

    const clerkJsPath = "/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js";
    const clerkUiPath = "/__clerk/npm/@clerk/ui@1/dist/ui.browser.js";

    const matchesClerkProxyRange = config.matcher.some((pattern) =>
      pattern.includes("__clerk")
    );
    expect(matchesClerkProxyRange).toBe(true);

    expect(
      shouldEnableFrontendApiProxy(
        new URL(`https://bite-wise.app${clerkJsPath}`)
      )
    ).toBe(true);
    expect(
      shouldEnableFrontendApiProxy(
        new URL(`https://bite-wise.app${clerkUiPath}`)
      )
    ).toBe(true);
    expect(
      shouldEnableFrontendApiProxy(new URL("https://bite-wise.app/sign-in"))
    ).toBe(false);

    const mockRedirectToSignIn = vi.fn();
    const unauthMiddlewareAuth = Object.assign(
      async () => ({
        userId: null,
        redirectToSignIn: mockRedirectToSignIn,
      }),
      { protect: vi.fn() }
    );

    const clerkProxyReq = new NextRequest(
      `https://bite-wise.app${clerkJsPath}`
    );
    const clerkProxyRes = await handleMiddlewareAuth(
      // Intentional partial mock of ClerkMiddlewareAuth for unit testing route protection
      unauthMiddlewareAuth as unknown as Parameters<
        typeof handleMiddlewareAuth
      >[0],
      clerkProxyReq
    );

    expect(mockRedirectToSignIn).not.toHaveBeenCalled();
    expect(clerkProxyRes?.status).toBe(200);
  });
});


