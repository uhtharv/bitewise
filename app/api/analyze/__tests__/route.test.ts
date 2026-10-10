import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiUsageRow, FoodRow } from "@/lib/supabase/user";

const mockRequireAuth = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: () => mockRequireAuth(),
}));

const VALID_ENV = {
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-3.5-flash",
  USDA_API_KEY: "test-usda-key",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
  CLERK_SECRET_KEY: "sk_test_123",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
};

function createMockAnalyzeSupabase(options?: {
  initialUsage?: AiUsageRow[];
  initialFoods?: FoodRow[];
  failUsageQuery?: boolean;
}) {
  const usageRows: AiUsageRow[] = [...(options?.initialUsage ?? [])];
  const foodRows: FoodRow[] = [...(options?.initialFoods ?? [])];
  const mealEntryWrites: unknown[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname.endsWith("/rest/v1/meal_entries")) {
      if (method !== "GET") {
        mealEntryWrites.push(init?.body);
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/rest/v1/ai_usage")) {
      if (options?.failUsageQuery) {
        return new Response(
          JSON.stringify({ message: "Database connection failed" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      if (method === "GET") {
        const userEq = url.searchParams.get("user_id");
        const dateEq = url.searchParams.get("usage_date");
        const userId = userEq?.startsWith("eq.") ? userEq.slice(3) : null;
        const usageDate = dateEq?.startsWith("eq.") ? dateEq.slice(3) : null;

        const matched = usageRows.filter(
          (r) =>
            (!userId || r.user_id === userId) &&
            (!usageDate || r.usage_date === usageDate)
        );
        return new Response(JSON.stringify(matched), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST" || method === "PATCH") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const payload = JSON.parse(bodyText) as Partial<AiUsageRow>;
        const userEq = url.searchParams.get("user_id");
        const dateEq = url.searchParams.get("usage_date");
        const userId =
          payload.user_id ??
          (userEq?.startsWith("eq.") ? userEq.slice(3) : "user_1");
        const usageDate =
          payload.usage_date ??
          (dateEq?.startsWith("eq.") ? dateEq.slice(3) : "2026-10-10");

        const existingIndex = usageRows.findIndex(
          (r) => r.user_id === userId && r.usage_date === usageDate
        );
        const updatedRow: AiUsageRow = {
          user_id: userId,
          usage_date: usageDate,
          count: Number(
            payload.count ??
              (existingIndex >= 0 ? usageRows[existingIndex].count + 1 : 1)
          ),
        };
        if (existingIndex >= 0) {
          usageRows[existingIndex] = updatedRow;
        } else {
          usageRows.push(updatedRow);
        }
        return new Response(JSON.stringify([updatedRow]), {
          status: method === "POST" ? 201 : 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname.endsWith("/rest/v1/foods")) {
      if (method === "GET") {
        const eqNormalized = url.searchParams.get("normalized_name");
        const target = eqNormalized?.startsWith("eq.")
          ? eqNormalized.slice(3)
          : null;
        const matched = target
          ? foodRows.filter((f) => f.normalized_name === target)
          : foodRows;
        return new Response(JSON.stringify(matched), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const payload = JSON.parse(bodyText) as Partial<FoodRow>;
        const newRow: FoodRow = {
          id: payload.id ?? "f00d0000-0000-4000-8000-000000000123",
          normalized_name: payload.normalized_name ?? "",
          display_name: payload.display_name ?? "",
          calories_per_100g: Number(payload.calories_per_100g ?? 0),
          protein_per_100g: Number(payload.protein_per_100g ?? 0),
          carbs_per_100g: Number(payload.carbs_per_100g ?? 0),
          fat_per_100g: Number(payload.fat_per_100g ?? 0),
          source: payload.source ?? "gemini",
          external_id: payload.external_id ?? null,
          is_estimated: Boolean(payload.is_estimated),
          created_at: "2026-10-10T10:00:00Z",
        };
        foodRows.push(newRow);
        return new Response(JSON.stringify([newRow]), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { mockFetch, usageRows, foodRows, mealEntryWrites };
}

describe("05 — POST /api/analyze & Daily Rate Limiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("returns 200 with scaled macros, per-100g fields, and is_estimated without writing to meal_entries", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_123");
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");

    const dbHarness = createMockAnalyzeSupabase();
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockAiProvider = {
      parseMealText: vi.fn().mockResolvedValue([
        {
          normalized_name: "dal tadka",
          display_name: "Dal Tadka",
          quantity_g: 300,
        },
      ]),
      estimateMacrosPer100g: vi.fn().mockResolvedValue({
        calories_per_100g: 110,
        protein_per_100g: 5.5,
        carbs_per_100g: 14,
        fat_per_100g: 3.5,
        is_estimated: true,
      }),
    };
    const mockLookupUsda = vi.fn().mockResolvedValue(null);

    const req = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "2 katori dal tadka" }),
    });

    const res = await handleAnalyzePost(req, {
      supabase,
      aiProvider: mockAiProvider,
      lookupUsdaFood: mockLookupUsda,
      now: () => new Date("2026-10-10T12:00:00Z"),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body).toEqual({
      items: [
        {
          food_id: "f00d0000-0000-4000-8000-000000000123",
          food_name: "Dal Tadka",
          quantity_g: 300,
          calories: 330,
          protein_g: 16.5,
          carbs_g: 42,
          fat_g: 10.5,
          calories_per_100g: 110,
          protein_per_100g: 5.5,
          carbs_per_100g: 14,
          fat_per_100g: 3.5,
          is_estimated: true,
        },
      ],
    });
    expect(dbHarness.usageRows).toEqual([
      { user_id: "user_123", usage_date: "2026-10-10", count: 1 },
    ]);
    expect(dbHarness.mealEntryWrites).toHaveLength(0);
  });

  it("returns 400 when input is invalid or exceeds 500 characters", async () => {
    mockRequireAuth.mockResolvedValue("user_123");
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");

    const emptyReq = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    const emptyRes = await handleAnalyzePost(emptyReq);
    expect(emptyRes.status).toBe(400);
    const emptyBody = (await emptyRes.json()) as { error: { code: string } };
    expect(emptyBody.error.code).toBe("BAD_REQUEST");

    const tooLongReq = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "a".repeat(501) }),
    });
    const tooLongRes = await handleAnalyzePost(tooLongReq);
    expect(tooLongRes.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      )
    );
    const { POST } = await import("@/app/api/analyze/route");

    const req = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "2 eggs" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 422 when meal text cannot be parsed into any food items", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_123");
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");

    const dbHarness = createMockAnalyzeSupabase();
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockAiProvider = {
      parseMealText: vi.fn().mockResolvedValue([]),
      estimateMacrosPer100g: vi.fn(),
    };

    const req = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello world not a meal" }),
    });

    const res = await handleAnalyzePost(req, {
      supabase,
      aiProvider: mockAiProvider,
      now: () => new Date("2026-10-10T12:00:00Z"),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("returns 429 when user has reached the daily limit of 30 analyses", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_123");
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");

    const dbHarness = createMockAnalyzeSupabase({
      initialUsage: [
        { user_id: "user_123", usage_date: "2026-10-10", count: 30 },
      ],
    });
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });
    const mockAiProvider = {
      parseMealText: vi.fn(),
      estimateMacrosPer100g: vi.fn(),
    };

    const req = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "1 apple" }),
    });

    const res = await handleAnalyzePost(req, {
      supabase,
      aiProvider: mockAiProvider,
      now: () => new Date("2026-10-10T18:00:00Z"),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(mockAiProvider.parseMealText).not.toHaveBeenCalled();
  });

  it("returns 502 when upstream Gemini or USDA API fails", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_123");
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");

    const dbHarness = createMockAnalyzeSupabase();
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockAiProvider = {
      parseMealText: vi
        .fn()
        .mockRejectedValue(new Error("Gemini API 503 Unavailable")),
      estimateMacrosPer100g: vi.fn(),
    };

    const req = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "2 rotis" }),
    });

    const res = await handleAnalyzePost(req, {
      supabase,
      aiProvider: mockAiProvider,
      now: () => new Date("2026-10-10T12:00:00Z"),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UPSTREAM_ERROR");
  });

  it("resolves parsed items in parallel and deduplicates in-flight lookups for the same normalized_name", async () => {
    mockRequireAuth.mockResolvedValueOnce("user_123");
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { handleAnalyzePost } = await import("@/app/api/analyze/route");

    const dbHarness = createMockAnalyzeSupabase();
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    let activeLookups = 0;
    let maxConcurrentLookups = 0;

    const mockLookupUsda = vi.fn().mockImplementation(async (query: string) => {
      activeLookups += 1;
      maxConcurrentLookups = Math.max(maxConcurrentLookups, activeLookups);
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeLookups -= 1;

      if (query === "boiled egg") {
        return {
          external_id: "173424",
          display_name: "Egg, boiled",
          calories_per_100g: 155,
          protein_per_100g: 12.6,
          carbs_per_100g: 1.1,
          fat_per_100g: 10.6,
        };
      }
      if (query === "white rice") {
        return {
          external_id: "171287",
          display_name: "Rice, white, cooked",
          calories_per_100g: 130,
          protein_per_100g: 2.7,
          carbs_per_100g: 28.2,
          fat_per_100g: 0.3,
        };
      }
      return null;
    });

    const mockAiProvider = {
      parseMealText: vi.fn().mockResolvedValue([
        {
          normalized_name: "boiled egg",
          display_name: "Boiled Egg (Morning)",
          quantity_g: 50,
        },
        {
          normalized_name: "boiled egg",
          display_name: "Boiled Egg (Extra)",
          quantity_g: 100,
        },
        {
          normalized_name: "white rice",
          display_name: "White Rice",
          quantity_g: 200,
        },
      ]),
      estimateMacrosPer100g: vi.fn(),
    };

    const req = new Request("https://example.com/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "1 boiled egg, 2 boiled eggs, and rice" }),
    });

    const res = await handleAnalyzePost(req, {
      supabase,
      aiProvider: mockAiProvider,
      lookupUsdaFood: mockLookupUsda,
      now: () => new Date("2026-10-10T12:00:00Z"),
    });

    expect(res.status).toBe(200);
    // "boiled egg" and "white rice" must run concurrently (maxConcurrentLookups >= 2),
    // while the second "boiled egg" shares the in-flight resolution (total calls === 2).
    expect(maxConcurrentLookups).toBeGreaterThanOrEqual(2);
    expect(mockLookupUsda).toHaveBeenCalledTimes(2);
    const body = (await res.json()) as {
      items: Array<{ food_name: string; quantity_g: number; calories: number }>;
    };
    expect(body.items).toHaveLength(3);
    expect(body.items[0]?.quantity_g).toBe(50);
    expect(body.items[0]?.calories).toBe(77.5);
    expect(body.items[1]?.quantity_g).toBe(100);
    expect(body.items[1]?.calories).toBe(155);
    expect(body.items[2]?.quantity_g).toBe(200);
    expect(body.items[2]?.calories).toBe(260);
  });
});


