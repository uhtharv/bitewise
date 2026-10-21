import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("Two-Tier Hybrid LLM-to-Database Pipeline (lib/nutrition/resolve-food)", () => {
  beforeEach(() => {
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("scaleMacro calculates deterministic serving values with 1-decimal rounding", async () => {
    const { scaleMacro } = await import("@/lib/nutrition/resolve-food");
    // 13.2g protein per 100g for 300g serving: (13.2 * 300) / 100 = 39.6
    expect(scaleMacro(13.2, 300)).toBe(39.6);
    // 379 kcal per 100g for 85g serving: (379 * 85) / 100 = 322.15 -> 322.2
    expect(scaleMacro(379, 85)).toBe(322.2);
    // 0g at 0 quantity
    expect(scaleMacro(10, 0)).toBe(0);
  });

  it("Tier 1: Direct match in Database A with score >= 0.35 calculates deterministic macros and flags is_estimated = false", async () => {
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");
    const mockSearchFoodRef = vi.fn().mockResolvedValue([
      {
        id: "usda-oats-uuid",
        normalized_name: "rolled oats, raw",
        display_name: "Rolled Oats",
        brand: null,
        source: "usda",
        external_id: "12345",
        calories_per_100g: 379,
        protein_per_100g: 13.2,
        carbs_per_100g: 67.7,
        fat_per_100g: 6.5,
        fiber_per_100g: 10.1,
        similarity_score: 0.92,
        is_estimated: false,
      },
    ]);

    const item = {
      normalized_name: "oats, raw",
      display_name: "Rolled Oats",
      normalized_query: "rolled oats raw",
      quantity_g: 200,
    };

    const resolved = await resolveFoodItem(item, {
      searchFoodRef: mockSearchFoodRef,
    });

    expect(mockSearchFoodRef).toHaveBeenCalledWith("rolled oats raw", {
      client: expect.anything(),
      minSimilarity: 0.35,
    });

    expect(resolved).toEqual({
      food_id: "usda-oats-uuid",
      food_name: "Rolled Oats",
      quantity_g: 200,
      calories: 758,
      protein_g: 26.4,
      carbs_g: 135.4,
      fat_g: 13,
      calories_per_100g: 379,
      protein_per_100g: 13.2,
      carbs_per_100g: 67.7,
      fat_per_100g: 6.5,
      is_estimated: false,
    });
  });

  it("Tier 2 Fallback A: When main item score < 0.35, matches candidate ingredients in DB A and aggregates recipe macros with is_estimated = false", async () => {
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");
    const mockSearchFoodRef = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes("special dal")) {
        return [{ similarity_score: 0.2 }];
      }
      if (query.includes("yellow lentils")) {
        return [
          {
            id: "ifct-lentils",
            display_name: "Yellow Lentils Raw",
            calories_per_100g: 340,
            protein_per_100g: 24,
            carbs_per_100g: 58,
            fat_per_100g: 1.5,
            similarity_score: 0.85,
            is_estimated: false,
          },
        ];
      }
      if (query.includes("ghee")) {
        return [
          {
            id: "ifct-ghee",
            display_name: "Desi Ghee",
            calories_per_100g: 900,
            protein_per_100g: 0,
            carbs_per_100g: 0,
            fat_per_100g: 100,
            similarity_score: 0.9,
            is_estimated: false,
          },
        ];
      }
      return [];
    });

    const item = {
      normalized_name: "grandmas special dal",
      display_name: "Grandma's Special Dal",
      normalized_query: "grandmas special dal",
      quantity_g: 100,
      is_composite: true,
      candidate_ingredients: [
        {
          name: "Yellow Lentils",
          normalized_query: "yellow lentils raw",
          quantity_g: 90,
        },
        {
          name: "Ghee",
          normalized_query: "cow ghee",
          quantity_g: 10,
        },
      ],
    };

    const resolved = await resolveFoodItem(item, {
      searchFoodRef: mockSearchFoodRef,
    });

    expect(resolved.food_id).toBeNull();
    expect(resolved.food_name).toBe("Grandma's Special Dal");
    expect(resolved.is_estimated).toBe(false);
    expect(resolved.calories).toBe(396);
    expect(resolved.protein_g).toBe(21.6);
  });

  it("Tier 2 Fallback B: When DB A match and ingredients both fail, falls back to emergency AI estimate with is_estimated = true", async () => {
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");
    const mockSearchFoodRef = vi.fn().mockResolvedValue([]);
    const mockAiProvider = {
      parseMealText: vi.fn(),
      estimateMacrosPer100g: vi.fn().mockResolvedValue({
        calories_per_100g: 180,
        protein_per_100g: 8,
        carbs_per_100g: 22,
        fat_per_100g: 6,
        is_estimated: true,
      }),
    };

    const item = {
      normalized_name: "unknown mystical snack",
      display_name: "Unknown Mystical Snack",
      normalized_query: "unknown mystical snack",
      quantity_g: 150,
    };

    const resolved = await resolveFoodItem(item, {
      searchFoodRef: mockSearchFoodRef,
      aiProvider: mockAiProvider,
    });

    expect(resolved.food_id).toBeNull();
    expect(resolved.is_estimated).toBe(true);
    expect(resolved.calories).toBe(270);
    expect(resolved.protein_g).toBe(12);
  });

  it("regression: routes searchFoodRef to foodDbClient instead of deps.supabase (Database B)", async () => {
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");
    const mockSearchFoodRef = vi.fn().mockResolvedValue([
      {
        id: "food-123",
        normalized_name: "boiled egg",
        display_name: "Boiled Egg",
        calories_per_100g: 155,
        protein_per_100g: 13,
        carbs_per_100g: 1.1,
        fat_per_100g: 11,
        similarity_score: 0.95,
        is_estimated: false,
      },
    ]);

    const mockFoodDb = { id: "mock-food-db-client" } as unknown as SupabaseClient;
    const mockUserDb = { id: "mock-user-db-client" } as unknown as SupabaseClient;

    await resolveFoodItem(
      {
        normalized_name: "boiled egg",
        display_name: "Boiled Egg",
        quantity_g: 100,
      },
      {
        foodDbClient: mockFoodDb,
        supabase: mockUserDb,
        searchFoodRef: mockSearchFoodRef,
      }
    );

    expect(mockSearchFoodRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ client: mockFoodDb })
    );
  });

  it("regression: tryResolveMealTextFromCache queries reference_foods on foodDbClient", async () => {
    const { tryResolveMealTextFromCache } = await import(
      "@/lib/nutrition/resolve-food"
    );

    const mockFoodDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              {
                id: "ref-rice-123",
                normalized_name: "white rice, cooked",
                display_name: "White Rice (Cooked)",
                calories_per_100g: 130,
                protein_per_100g: 2.7,
                carbs_per_100g: 28,
                fat_per_100g: 0.3,
                is_estimated: false,
              },
            ],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await tryResolveMealTextFromCache(
      "200g cooked white rice",
      undefined,
      mockFoodDb
    );

    expect(mockFoodDb.from).toHaveBeenCalledWith("reference_foods");
    expect(result).not.toBeNull();
    expect(result?.[0]?.food_name).toBe("White Rice (Cooked)");
    expect(result?.[0]?.calories).toBe(260);
    expect(result?.[0]?.is_estimated).toBe(false);
  });
});




