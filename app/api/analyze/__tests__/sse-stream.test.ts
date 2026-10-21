import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/user";

const VALID_ENV = {
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-2.5-flash",
  USDA_API_KEY: "test-usda-key",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon",
  FOOD_DATABASE_URL: "https://food-ref.supabase.co",
  FOOD_DATABASE_ANON_KEY: "food-ref-anon-key",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
  CLERK_SECRET_KEY: "sk_test_123",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
};

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAuth: () => mockRequireAuth(),
}));

function createMockSupabase() {
  const usageStore: Record<string, number> = {};

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "ai_usage") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            return {
              eq: vi.fn().mockResolvedValue({
                data: usageStore[val] ? [{ user_id: val, count: usageStore[val] }] : [],
                error: null,
              }),
            };
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnThis(),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        upsert: vi.fn().mockReturnThis(),
      };
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("POST /api/analyze SSE Streaming (app/api/analyze)", () => {
  beforeEach(() => {
    process.env = { ...process.env, ...VALID_ENV };
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue("user_sse_test");
  });

  it("streams items via Server-Sent Events when Accept header includes text/event-stream", async () => {
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");
    const supabase = createMockSupabase();

    const mockAiProvider = {
      parseMealText: vi.fn().mockResolvedValue([
        {
          normalized_name: "boiled egg, cooked",
          display_name: "Boiled Egg",
          quantity_g: 50,
          estimated_macros_per_100g: {
            calories_per_100g: 155,
            protein_per_100g: 13,
            carbs_per_100g: 1.1,
            fat_per_100g: 11,
            is_estimated: false,
          },
        },
      ]),
      estimateMacrosPer100g: vi.fn(),
    };

    const request = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ text: "1 boiled egg" }),
    });

    const response = await handleAnalyzePost(request, {
      supabase,
      aiProvider: mockAiProvider,
      now: () => new Date("2026-10-10T10:00:00Z"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let text = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toContain("event: start");
    expect(text).toContain("event: item");
    expect(text).toContain("event: done");
    expect(text).toContain('"food_name":"Boiled Egg"');
  });
});

