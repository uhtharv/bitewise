import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodRow } from "@/lib/supabase/user";

const VALID_ENV = {
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "gemini-2.5-flash",
  USDA_API_KEY: "test-usda-key",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
  CLERK_SECRET_KEY: "sk_test_123",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
};

function createMockFoodsSupabaseClient(initialFoods: FoodRow[] = []) {
  const foods = [...initialFoods];
  const insertedRows: Array<Partial<FoodRow>> = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname.endsWith("/rest/v1/foods")) {
      if (method === "GET") {
        const eqNormalized = url.searchParams.get("normalized_name");
        const target = eqNormalized?.startsWith("eq.")
          ? eqNormalized.slice(3)
          : null;
        const matched = target
          ? foods.filter((f) => f.normalized_name === target)
          : foods;
        const accept = new Headers(init?.headers).get("Accept") ?? "";
        if (accept.includes("application/vnd.pgrst.object+json")) {
          if (matched.length === 0) {
            return new Response(null, { status: 406 });
          }
          return new Response(JSON.stringify(matched[0]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(matched), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST") {
        const bodyText = typeof init?.body === "string" ? init.body : "";
        const payload = JSON.parse(bodyText) as Partial<FoodRow>;
        const newRow: FoodRow = {
          id: payload.id ?? "f00d0000-0000-4000-8000-000000000099",
          normalized_name: payload.normalized_name ?? "",
          display_name: payload.display_name ?? "",
          calories_per_100g: Number(payload.calories_per_100g ?? 0),
          protein_per_100g: Number(payload.protein_per_100g ?? 0),
          carbs_per_100g: Number(payload.carbs_per_100g ?? 0),
          fat_per_100g: Number(payload.fat_per_100g ?? 0),
          source: payload.source ?? "usda",
          external_id: payload.external_id ?? null,
          is_estimated: Boolean(payload.is_estimated),
          created_at: "2026-10-10T10:00:00Z",
        };
        foods.push(newRow);
        insertedRows.push(payload);
        const accept = new Headers(init?.headers).get("Accept") ?? "";
        if (accept.includes("application/vnd.pgrst.object+json")) {
          return new Response(JSON.stringify(newRow), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
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

  return { mockFetch, foods, insertedRows };
}

describe("04 — AI Provider & Nutrition Resolution Pipeline", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("GeminiProvider reads model ID from process.env.GEMINI_MODEL and throws if unset", async () => {
    const { GeminiProvider } = await import("@/lib/ai/provider");

    delete process.env.GEMINI_MODEL;

    expect(() => new GeminiProvider({ apiKey: "test-key" })).toThrow(
      /GEMINI_MODEL/
    );
  });

  it("GeminiProvider.parseMealText() returns structured items and normalizes household units to grams", async () => {
    const { GeminiProvider, normalizeHouseholdUnitToGrams } = await import(
      "@/lib/ai/provider"
    );

    expect(normalizeHouseholdUnitToGrams(2, "katori")).toBe(300);
    expect(normalizeHouseholdUnitToGrams(2, "roti")).toBe(70);
    expect(normalizeHouseholdUnitToGrams(1.5, "cup")).toBe(300);
    expect(normalizeHouseholdUnitToGrams(2, "tbsp")).toBe(30);

    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        items: [
          {
            normalized_name: "Dal Tadka",
            display_name: "Dal Tadka",
            quantity: 2,
            unit: "katori",
            quantity_g: 300,
            estimated_macros_per_100g: {
              calories_per_100g: 110,
              protein_per_100g: 5.5,
              carbs_per_100g: 14,
              fat_per_100g: 3.5,
            },
          },
          {
            normalized_name: "Roti",
            display_name: "Whole Wheat Roti",
            quantity: 2,
            unit: "roti",
          },
        ],
      }),
    });

    const provider = new GeminiProvider({
      client: { models: { generateContent: mockGenerateContent } },
    });

    const parsed = await provider.parseMealText(
      "2 katori dal tadka and 2 rotis"
    );

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash",
        config: expect.objectContaining({
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        }),
      })
    );
    expect(parsed).toEqual([
      {
        normalized_name: "dal tadka",
        display_name: "Dal Tadka",
        quantity: 2,
        unit: "katori",
        quantity_g: 300,
        estimated_macros_per_100g: {
          calories_per_100g: 110,
          protein_per_100g: 5.5,
          carbs_per_100g: 14,
          fat_per_100g: 3.5,
        },
      },
      {
        normalized_name: "roti",
        display_name: "Whole Wheat Roti",
        quantity: 2,
        unit: "roti",
        quantity_g: 70,
      },
    ]);
  });

  it("GeminiProvider.estimateMacrosPer100g() validates AI output with zod and returns is_estimated = true", async () => {
    const { GeminiProvider } = await import("@/lib/ai/provider");

    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        calories_per_100g: 110,
        protein_per_100g: 5.5,
        carbs_per_100g: 14,
        fat_per_100g: 3.5,
      }),
    });

    const provider = new GeminiProvider({
      client: { models: { generateContent: mockGenerateContent } },
    });

    const estimate = await provider.estimateMacrosPer100g("Dal Tadka");

    expect(estimate).toEqual({
      calories_per_100g: 110,
      protein_per_100g: 5.5,
      carbs_per_100g: 14,
      fat_per_100g: 3.5,
      is_estimated: true,
    });
  });

  it("resolveFoodItem() cache-hit path returns cached data without calling USDA or Gemini", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const cachedFood: FoodRow = {
      id: "11111111-2222-4333-8444-555555555555",
      normalized_name: "boiled egg",
      display_name: "Boiled Egg",
      calories_per_100g: 155,
      protein_per_100g: 12.6,
      carbs_per_100g: 1.1,
      fat_per_100g: 10.6,
      source: "usda",
      external_id: "173424",
      is_estimated: false,
      created_at: "2026-10-10T08:00:00Z",
    };

    const dbHarness = createMockFoodsSupabaseClient([cachedFood]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });
    const mockUsdaLookup = vi.fn();
    const mockAiProvider = {
      parseMealText: vi.fn(),
      estimateMacrosPer100g: vi.fn(),
    };

    const resolved = await resolveFoodItem(
      {
        normalized_name: "boiled egg",
        display_name: "Boiled Egg",
        quantity_g: 50,
      },
      {
        supabase,
        lookupUsdaFood: mockUsdaLookup,
        aiProvider: mockAiProvider,
      }
    );

    expect(mockUsdaLookup).not.toHaveBeenCalled();
    expect(mockAiProvider.estimateMacrosPer100g).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      food_id: "11111111-2222-4333-8444-555555555555",
      food_name: "Boiled Egg",
      quantity_g: 50,
      calories: 77.5,
      protein_g: 6.3,
      carbs_g: 0.6,
      fat_g: 5.3,
      calories_per_100g: 155,
      protein_per_100g: 12.6,
      carbs_per_100g: 1.1,
      fat_per_100g: 10.6,
      is_estimated: false,
    });
  });

  it("resolveFoodItem() USDA-hit path queries USDA on cache miss and caches result in foods", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { lookupUsdaFood } = await import("@/lib/nutrition/usda");
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const dbHarness = createMockFoodsSupabaseClient([]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockUsdaFetch: typeof fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          foods: [
            {
              fdcId: 171287,
              description: "Rice, white, cooked",
              foodNutrients: [
                { nutrientId: 1008, value: 130 },
                { nutrientId: 1003, value: 2.7 },
                { nutrientId: 1005, value: 28.2 },
                { nutrientId: 1004, value: 0.3 },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const mockAiProvider = {
      parseMealText: vi.fn(),
      estimateMacrosPer100g: vi.fn(),
    };

    const resolved = await resolveFoodItem(
      {
        normalized_name: "white rice",
        display_name: "White Rice",
        quantity_g: 200,
      },
      {
        supabase,
        lookupUsdaFood: (query) =>
          lookupUsdaFood(query, { fetch: mockUsdaFetch }),
        aiProvider: mockAiProvider,
      }
    );

    expect(mockUsdaFetch).toHaveBeenCalledTimes(1);
    expect(mockAiProvider.estimateMacrosPer100g).not.toHaveBeenCalled();
    expect(dbHarness.insertedRows).toHaveLength(1);
    expect(dbHarness.insertedRows[0]).toMatchObject({
      normalized_name: "white rice",
      display_name: "White Rice",
      calories_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28.2,
      fat_per_100g: 0.3,
      source: "usda",
      external_id: "171287",
      is_estimated: false,
    });
    expect(resolved).toEqual({
      food_id: "f00d0000-0000-4000-8000-000000000099",
      food_name: "White Rice",
      quantity_g: 200,
      calories: 260,
      protein_g: 5.4,
      carbs_g: 56.4,
      fat_g: 0.6,
      calories_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28.2,
      fat_per_100g: 0.3,
      is_estimated: false,
    });
  });

  it("resolveFoodItem() Gemini-fallback path sets is_estimated = true and caches in foods", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const dbHarness = createMockFoodsSupabaseClient([]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockUsdaLookup = vi.fn().mockResolvedValue(null);
    const mockAiProvider = {
      parseMealText: vi.fn(),
      estimateMacrosPer100g: vi.fn().mockResolvedValue({
        calories_per_100g: 110,
        protein_per_100g: 5.5,
        carbs_per_100g: 14,
        fat_per_100g: 3.5,
        is_estimated: true,
      }),
    };

    const resolved = await resolveFoodItem(
      {
        normalized_name: "dal tadka",
        display_name: "Dal Tadka",
        quantity_g: 300,
      },
      {
        supabase,
        lookupUsdaFood: mockUsdaLookup,
        aiProvider: mockAiProvider,
      }
    );

    expect(mockUsdaLookup).toHaveBeenCalledWith("dal tadka");
    expect(mockAiProvider.estimateMacrosPer100g).toHaveBeenCalledWith(
      "Dal Tadka"
    );
    expect(dbHarness.insertedRows).toHaveLength(1);
    expect(dbHarness.insertedRows[0]).toMatchObject({
      normalized_name: "dal tadka",
      display_name: "Dal Tadka",
      source: "gemini",
      external_id: null,
      is_estimated: true,
    });
    expect(resolved.is_estimated).toBe(true);
    expect(resolved.calories).toBe(330);
    expect(resolved.protein_g).toBe(16.5);
    expect(resolved.carbs_g).toBe(42);
    expect(resolved.fat_g).toBe(10.5);
  });

  it("falls back to Gemini (is_estimated = true) when upstream USDA API fails or times out, and reuses inline estimated_macros_per_100g without a second Gemini call", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { lookupUsdaFood } = await import("@/lib/nutrition/usda");
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const dbHarness = createMockFoodsSupabaseClient([]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const failingUsdaFetch: typeof fetch = vi.fn(async () =>
      new Response("Service Unavailable", { status: 503 })
    );
    const mockEstimateMacros = vi.fn();

    const resolved = await resolveFoodItem(
      {
        normalized_name: "paneer tikka",
        display_name: "Paneer Tikka",
        quantity_g: 150,
        estimated_macros_per_100g: {
          calories_per_100g: 260,
          protein_per_100g: 18,
          carbs_per_100g: 6,
          fat_per_100g: 18,
        },
      },
      {
        supabase,
        lookupUsdaFood: (query) =>
          lookupUsdaFood(query, { fetch: failingUsdaFetch }),
        aiProvider: {
          parseMealText: vi.fn(),
          estimateMacrosPer100g: mockEstimateMacros,
        },
      }
    );

    expect(mockEstimateMacros).not.toHaveBeenCalled();
    expect(resolved).toMatchObject({
      food_name: "Paneer Tikka",
      quantity_g: 150,
      calories: 390,
      protein_g: 27,
      carbs_g: 9,
      fat_g: 27,
      is_estimated: true,
    });
  });

  it("lookupUsdaFood() sanitizes Lucene operators, sends X-Api-Key header, and parses OpenAPI v3 abridged/nested nutrient shapes", async () => {
    const { lookupUsdaFood, sanitizeUsdaQuery } = await import(
      "@/lib/nutrition/usda"
    );

    expect(sanitizeUsdaQuery("boiled egg (1 large) - 50g/unit")).toBe(
      "boiled egg 1 large 50g unit"
    );

    const mockFetch: typeof fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          foods: [
            {
              fdcId: 748967,
              description: "Eggs, Grade A, Large, egg whole",
              foodNutrients: [
                { nutrient: { id: 2048, number: "958" }, amount: 143 },
                { number: 203, amount: 12.6 },
                { number: "205", amount: 0.72 },
                { nutrientId: 1004, value: 9.51 },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const match = await lookupUsdaFood("boiled egg (large)", {
      apiKey: "  usda-key-123  ",
      fetch: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("query=boiled+egg+large"),
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Api-Key": "usda-key-123",
        },
      })
    );
    expect(match).toEqual({
      external_id: "748967",
      display_name: "Eggs, Grade A, Large, egg whole",
      calories_per_100g: 143,
      protein_per_100g: 12.6,
      carbs_per_100g: 0.72,
      fat_per_100g: 9.51,
    });
  });
});



