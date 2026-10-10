import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-2.5-flash",
  USDA_API_KEY: "test-usda-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
  CLERK_SECRET_KEY: "sk_test_123",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
};

describe("lib/env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, ...VALID_ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("exports validated env vars when all required variables are present", async () => {
    const { env } = await import("@/lib/env");

    expect(env).toEqual(VALID_ENV);
  });

  it("throws at import time when GEMINI_MODEL is unset", async () => {
    delete process.env.GEMINI_MODEL;

    await expect(import("@/lib/env")).rejects.toThrow(/GEMINI_MODEL/);
  });

  it("throws at import time when SUPABASE_SERVICE_ROLE_KEY is unset", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(import("@/lib/env")).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/
    );
  });

  it.each(Object.keys(VALID_ENV) as Array<keyof typeof VALID_ENV>)(
    "throws at import time when required variable %s is empty or whitespace",
    async (key) => {
      process.env[key] = "   ";

      await expect(import("@/lib/env")).rejects.toThrow(new RegExp(key));
    }
  );
});
