import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

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

describe("lib/supabase/food-db", () => {
  beforeEach(() => {
    process.env = { ...process.env, ...VALID_ENV };
  });

  it("returns configured food database URL and key or falls back to public Supabase env vars", async () => {
    const { getFoodDatabaseConfig } = await import("@/lib/supabase/food-db");
    const config = getFoodDatabaseConfig();
    expect(config.url).toBe("https://food-ref.supabase.co");
    expect(config.key).toBe("food-ref-anon-key");
  });

  it("creates a stateless Supabase client with auth session persistence disabled", async () => {
    const { createFoodReferenceClient } = await import("@/lib/supabase/food-db");
    const client = createFoodReferenceClient();
    expect(client).toBeDefined();
  });

  it("calls search_food_reference RPC with trimmed query and default min_similarity 0.35", async () => {
    const { searchFoodReference } = await import("@/lib/supabase/food-db");
    const mockRpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "11111111-2222-3333-4444-555555555555",
          normalized_name: "rolled oats, raw",
          display_name: "Rolled Oats (Raw)",
          brand: null,
          source: "usda",
          external_id: "12345",
          calories_per_100g: 379,
          protein_per_100g: 13.2,
          carbs_per_100g: 67.7,
          fat_per_100g: 6.5,
          fiber_per_100g: 10.1,
          similarity_score: 0.88,
          is_estimated: false,
        },
      ],
      error: null,
    });

    const mockClient = {
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const results = await searchFoodReference("  oats raw  ", {
      client: mockClient,
      minSimilarity: 0.35,
    });

    expect(mockRpc).toHaveBeenCalledWith("search_food_reference", {
      query_text: "oats raw",
      min_similarity: 0.35,
      max_results: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0].display_name).toBe("Rolled Oats (Raw)");
    expect(results[0].similarity_score).toBe(0.88);
    expect(results[0].is_estimated).toBe(false);
  });

  it("returns empty array immediately when queryText is empty or whitespace", async () => {
    const { searchFoodReference } = await import("@/lib/supabase/food-db");
    const mockRpc = vi.fn();
    const mockClient = { rpc: mockRpc } as unknown as SupabaseClient;

    const results = await searchFoodReference("   ", { client: mockClient });
    expect(results).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("falls back to ilike query on reference_foods if RPC function fails", async () => {
    const { searchFoodReference } = await import("@/lib/supabase/food-db");
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function search_food_reference does not exist" },
    });

    const mockSelect = vi.fn().mockReturnThis();
    const mockIlike = vi.fn().mockReturnThis();
    const mockLimit = vi.fn().mockResolvedValue({
      data: [
        {
          id: "22222222-3333-4444-5555-666666666666",
          normalized_name: "dal tadka",
          display_name: "Dal Tadka",
          brand: null,
          source: "ifct",
          external_id: "IFCT-01",
          calories_per_100g: 110,
          protein_per_100g: 5.5,
          carbs_per_100g: 14,
          fat_per_100g: 3.5,
          fiber_per_100g: 2.1,
          is_estimated: false,
        },
      ],
      error: null,
    });

    const mockClient = {
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        ilike: mockIlike,
        limit: mockLimit,
      }),
    } as unknown as SupabaseClient;

    const results = await searchFoodReference("dal tadka", { client: mockClient });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("ifct");
    expect(results[0].similarity_score).toBe(1.0);
  });
});

