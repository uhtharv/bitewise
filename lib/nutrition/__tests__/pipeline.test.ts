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
        let matched = foods;
        if (eqNormalized?.startsWith("eq.")) {
          const target = eqNormalized.slice(3);
          matched = foods.filter((f) => f.normalized_name === target);
        } else if (
          eqNormalized?.startsWith("in.(") &&
          eqNormalized.endsWith(")")
        ) {
          const inner = eqNormalized.slice(4, -1);
          const targets = new Set<string>();
          for (const match of inner.matchAll(/"([^"]*)"|([^,]+)/g)) {
            const val = (match[1] ?? match[2] ?? "").trim();
            if (val) targets.add(val);
          }
          matched = foods.filter((f) => targets.has(f.normalized_name));
        }
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
        const existingIdx = foods.findIndex(
          (f) => f.normalized_name === (payload.normalized_name ?? "")
        );
        const newRow: FoodRow = {
          id:
            payload.id ??
            (existingIdx >= 0
              ? foods[existingIdx].id
              : `f00d0000-0000-4000-8000-00000000009${foods.length + 1}`),
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
        if (existingIdx >= 0) {
          foods[existingIdx] = newRow;
        } else {
          foods.push(newRow);
        }
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

  it("normalizeHouseholdUnitToGrams() enforces exact weight/spoon multipliers and trusts Gemini quantity_g first for food-dependent units", async () => {
    const { normalizeHouseholdUnitToGrams } = await import(
      "@/lib/ai/provider"
    );

    // Exact weight/spoon units use deterministic server multipliers
    expect(normalizeHouseholdUnitToGrams(300, "gms", 100)).toBe(300);
    expect(normalizeHouseholdUnitToGrams(250, "gm")).toBe(250);
    expect(normalizeHouseholdUnitToGrams(2, "tbsp", 50)).toBe(30);
    expect(normalizeHouseholdUnitToGrams(1, "tsp")).toBe(5);
    expect(normalizeHouseholdUnitToGrams(0.5, "kg")).toBe(500);

    // Food-dependent units trust Gemini's context-aware quantity_g first
    expect(normalizeHouseholdUnitToGrams(1, "cup", 85)).toBe(85);
    expect(normalizeHouseholdUnitToGrams(1, "slice", 20)).toBe(20);
    expect(normalizeHouseholdUnitToGrams(2, "katori", 300)).toBe(300);

    // Food-dependent units fall back to reference table when quantity_g is omitted
    expect(normalizeHouseholdUnitToGrams(2, "katori")).toBe(300);
    expect(normalizeHouseholdUnitToGrams(2, "roti")).toBe(70);
    expect(normalizeHouseholdUnitToGrams(1.5, "cup")).toBe(300);
  });

  it("GeminiProvider.parseMealText() returns structured items, preserves food-specific quantity_g, and normalizes drifted Atwater calories", async () => {
    const { GeminiProvider } = await import("@/lib/ai/provider");

    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        items: [
          {
            normalized_name: "Oats, Dry",
            display_name: "Oats (Dry)",
            quantity: 1,
            unit: "cup",
            quantity_g: 85,
            estimated_macros_per_100g: {
              calories_per_100g: 800, // Drifted >20% and >30 kcal from Atwater (4*13 + 4*68 + 9*6.5 = 382.5)
              protein_per_100g: 13,
              carbs_per_100g: 68,
              fat_per_100g: 6.5,
              is_estimated: false,
            },
          },
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
              is_estimated: true,
            },
          },
          {
            normalized_name: "Roti, Cooked",
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
      "1 cup dry oats, 2 katori dal tadka and 2 rotis"
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
        normalized_name: "oats, dry",
        display_name: "Oats (Dry)",
        quantity: 1,
        unit: "cup",
        quantity_g: 85,
        estimated_macros_per_100g: {
          calories_per_100g: 382.5,
          protein_per_100g: 13,
          carbs_per_100g: 68,
          fat_per_100g: 6.5,
          is_estimated: false,
        },
      },
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
          is_estimated: true,
        },
      },
      {
        normalized_name: "roti, cooked",
        display_name: "Whole Wheat Roti",
        quantity: 2,
        unit: "roti",
        quantity_g: 70,
      },
    ]);
  });

  it("macroPer100gSchema rejects physically impossible per-100g values (P+C+F > 105g, single macro > 100g, or calories > 900 kcal) with UnparseableMealError", async () => {
    const { GeminiProvider, UnparseableMealError } = await import(
      "@/lib/ai/provider"
    );

    const impossibleSumProvider = new GeminiProvider({
      client: {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              items: [
                {
                  normalized_name: "oats, dry",
                  display_name: "Oats",
                  quantity: 300,
                  unit: "gms",
                  quantity_g: 300,
                  estimated_macros_per_100g: {
                    calories_per_100g: 600,
                    protein_per_100g: 40,
                    carbs_per_100g: 50,
                    fat_per_100g: 20, // 40 + 50 + 20 = 110g > 105g
                  },
                },
              ],
            }),
          }),
        },
      },
    });

    await expect(
      impossibleSumProvider.parseMealText("300 gms oats")
    ).rejects.toBeInstanceOf(UnparseableMealError);

    const impossibleCaloriesProvider = new GeminiProvider({
      client: {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              items: [
                {
                  normalized_name: "oats, dry",
                  display_name: "Oats",
                  quantity: 300,
                  unit: "gms",
                  quantity_g: 300,
                  estimated_macros_per_100g: {
                    calories_per_100g: 2652, // > 900 kcal per 100g
                    protein_per_100g: 0,
                    carbs_per_100g: 0,
                    fat_per_100g: 300, // > 100g per 100g
                  },
                },
              ],
            }),
          }),
        },
      },
    });

    await expect(
      impossibleCaloriesProvider.parseMealText("300 gms oats")
    ).rejects.toBeInstanceOf(UnparseableMealError);
  });

  it("GeminiProvider.estimateMacrosPer100g() validates AI output with zod and preserves is_estimated (defaulting to true when omitted)", async () => {
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

  it("resolveFoodItem() cache-hit path returns cached data without calling Gemini", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const cachedFood: FoodRow = {
      id: "11111111-2222-4333-8444-555555555555",
      normalized_name: "boiled egg, cooked",
      display_name: "Boiled Egg",
      calories_per_100g: 155,
      protein_per_100g: 12.6,
      carbs_per_100g: 1.1,
      fat_per_100g: 10.6,
      source: "gemini",
      external_id: null,
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
        normalized_name: "boiled egg, cooked",
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

  it("resolveFoodItem() cache-miss path resolves directly from Gemini single-pass macros without calling USDA, preserving is_estimated=false for staples and is_estimated=true for composite dishes", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const dbHarness = createMockFoodsSupabaseClient([]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockUsdaLookup = vi.fn();
    const mockEstimateMacros = vi.fn();

    const resolvedStaple = await resolveFoodItem(
      {
        normalized_name: "oats, dry",
        display_name: "Oats (Dry)",
        quantity_g: 300,
        estimated_macros_per_100g: {
          calories_per_100g: 379,
          protein_per_100g: 13.2,
          carbs_per_100g: 67.7,
          fat_per_100g: 6.5,
          is_estimated: false,
        },
      },
      {
        supabase,
        lookupUsdaFood: mockUsdaLookup,
        aiProvider: {
          parseMealText: vi.fn(),
          estimateMacrosPer100g: mockEstimateMacros,
        },
      }
    );

    expect(mockUsdaLookup).not.toHaveBeenCalled();
    expect(mockEstimateMacros).not.toHaveBeenCalled();
    expect(dbHarness.insertedRows[0]).toMatchObject({
      normalized_name: "oats, dry",
      display_name: "Oats (Dry)",
      calories_per_100g: 379,
      protein_per_100g: 13.2,
      carbs_per_100g: 67.7,
      fat_per_100g: 6.5,
      source: "gemini",
      external_id: null,
      is_estimated: false,
    });
    expect(resolvedStaple).toMatchObject({
      food_name: "Oats (Dry)",
      quantity_g: 300,
      calories: 1137,
      protein_g: 39.6,
      carbs_g: 203.1,
      fat_g: 19.5,
      is_estimated: false,
    });

    const resolvedComposite = await resolveFoodItem(
      {
        normalized_name: "dal tadka",
        display_name: "Dal Tadka",
        quantity_g: 300,
        estimated_macros_per_100g: {
          calories_per_100g: 110,
          protein_per_100g: 5.5,
          carbs_per_100g: 14,
          fat_per_100g: 3.5,
          is_estimated: true,
        },
      },
      {
        supabase,
        lookupUsdaFood: mockUsdaLookup,
        aiProvider: {
          parseMealText: vi.fn(),
          estimateMacrosPer100g: mockEstimateMacros,
        },
      }
    );

    expect(mockUsdaLookup).not.toHaveBeenCalled();
    expect(resolvedComposite.is_estimated).toBe(true);
    expect(resolvedComposite.calories).toBe(330);
  });

  it("resolveFoodItem() falls back to estimateMacrosPer100g when inline estimated_macros_per_100g is omitted", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    const dbHarness = createMockFoodsSupabaseClient([]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    const mockUsdaLookup = vi.fn();
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

    expect(mockUsdaLookup).not.toHaveBeenCalled();
    expect(mockAiProvider.estimateMacrosPer100g).toHaveBeenCalledWith(
      "Dal Tadka"
    );
    expect(resolved.is_estimated).toBe(true);
    expect(resolved.calories).toBe(330);
  });

  it("parseMealText() and resolveFoodItem() resolve both Dry/Raw and Cooked variants into state-specific foods rows and default selected_state appropriately", async () => {
    const { GeminiProvider } = await import("@/lib/ai/provider");
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    let nextId = 1;
    const dbHarness = createMockFoodsSupabaseClient([]);
    const baseFetch = dbHarness.mockFetch;
    const mockFetch: typeof fetch = async (input, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        body.id = `f00d0000-0000-4000-8000-00000000000${nextId++}`;
        return baseFetch(input, { ...init, body: JSON.stringify(body) });
      }
      return baseFetch(input, init);
    };

    const supabase = createServiceSupabaseClient({ fetch: mockFetch });

    const provider = new GeminiProvider({
      client: {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              items: [
                {
                  normalized_name: "oats, dry",
                  display_name: "Oats (Dry)",
                  quantity: 300,
                  unit: "gms",
                  quantity_g: 300,
                  variants: [
                    {
                      state: "dry",
                      label: "Dry",
                      normalized_name: "Oats, Dry",
                      display_name: "Oats (Dry)",
                      quantity_g: 300,
                      macros_per_100g: {
                        calories_per_100g: 379,
                        protein_per_100g: 13.2,
                        carbs_per_100g: 67.7,
                        fat_per_100g: 6.5,
                        is_estimated: false,
                      },
                    },
                    {
                      state: "cooked",
                      label: "Cooked",
                      normalized_name: "Oats, Cooked",
                      display_name: "Oats (Cooked)",
                      quantity_g: 300,
                      macros_per_100g: {
                        calories_per_100g: 71,
                        protein_per_100g: 2.5,
                        carbs_per_100g: 12,
                        fat_per_100g: 1.4,
                        is_estimated: false,
                      },
                    },
                  ],
                },
                {
                  normalized_name: "oats, cooked",
                  display_name: "Oats (Cooked)",
                  quantity: 1,
                  unit: "cup",
                  quantity_g: 200,
                  variants: [
                    {
                      state: "dry",
                      label: "Dry",
                      normalized_name: "Oats, Dry",
                      display_name: "Oats (Dry)",
                      quantity_g: 85,
                      macros_per_100g: {
                        calories_per_100g: 379,
                        protein_per_100g: 13.2,
                        carbs_per_100g: 67.7,
                        fat_per_100g: 6.5,
                        is_estimated: false,
                      },
                    },
                    {
                      state: "cooked",
                      label: "Cooked",
                      normalized_name: "Oats, Cooked",
                      display_name: "Oats (Cooked)",
                      quantity_g: 200,
                      macros_per_100g: {
                        calories_per_100g: 71,
                        protein_per_100g: 2.5,
                        carbs_per_100g: 12,
                        fat_per_100g: 1.4,
                        is_estimated: false,
                      },
                    },
                  ],
                },
              ],
            }),
          }),
        },
      },
    });

    const parsed = await provider.parseMealText("300 gms oats and 1 cup oats");
    // "300 gms oats" -> defaults to "dry"
    expect(parsed[0]?.selected_state).toBe("dry");
    expect(parsed[0]?.quantity_g).toBe(300);
    // "1 cup oats" -> defaults to "cooked" (200g), while its "dry" variant has 85g
    expect(parsed[1]?.selected_state).toBe("cooked");
    expect(parsed[1]?.quantity_g).toBe(200);
    expect(parsed[1]?.variants?.[0]?.quantity_g).toBe(85);

    const resolvedGramsOats = await resolveFoodItem(parsed[0]!, { supabase });
    expect(resolvedGramsOats.selected_state).toBe("dry");
    expect(resolvedGramsOats.food_name).toBe("Oats (Dry)");
    expect(resolvedGramsOats.calories).toBe(1137);
    expect(resolvedGramsOats.variants).toHaveLength(2);
    expect(resolvedGramsOats.variants?.[1]?.food_name).toBe("Oats (Cooked)");
    expect(resolvedGramsOats.variants?.[1]?.calories).toBe(213);
    // Both "oats, dry" and "oats, cooked" are cached as distinct rows in `foods`
    expect(dbHarness.foods.map((f) => f.normalized_name)).toEqual([
      "oats, dry",
      "oats, cooked",
    ]);
  });

  it("GeminiProvider retries transient 503 UNAVAILABLE errors from generateContent before succeeding", async () => {
    const { GeminiProvider } = await import("@/lib/ai/provider");

    const transient503 = Object.assign(
      new Error(
        '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
      ),
      { status: 503 }
    );

    const mockGenerateContent = vi
      .fn()
      .mockRejectedValueOnce(transient503)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          items: [
            {
              normalized_name: "oats, dry",
              display_name: "Oats (Dry)",
              quantity: 300,
              unit: "gms",
              quantity_g: 300,
              estimated_macros_per_100g: {
                calories_per_100g: 389,
                protein_per_100g: 16.9,
                carbs_per_100g: 66.3,
                fat_per_100g: 6.9,
                is_estimated: false,
              },
            },
          ],
        }),
      });

    const provider = new GeminiProvider({
      client: { models: { generateContent: mockGenerateContent } },
      retryDelayMs: 1,
    });

    const items = await provider.parseMealText("300 gms oats");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
    expect(items[0]?.normalized_name).toBe("oats, dry");
  });

  it("resolveFoodItem() uses upsert on normalized_name so concurrent cache writes do not fail with duplicate key error", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { resolveFoodItem } = await import("@/lib/nutrition/resolve-food");

    let postUrl = "";
    let preferHeader = "";
    const dbHarness = createMockFoodsSupabaseClient([]);
    const baseFetch = dbHarness.mockFetch;
    const mockFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);
      if (
        url.pathname.endsWith("/rest/v1/foods") &&
        (init?.method ?? "GET").toUpperCase() === "POST"
      ) {
        postUrl = url.toString();
        preferHeader = new Headers(init?.headers).get("Prefer") ?? "";
      }
      return baseFetch(input, init);
    };

    const supabase = createServiceSupabaseClient({ fetch: mockFetch });
    await resolveFoodItem(
      {
        normalized_name: "oats, dry",
        display_name: "Oats (Dry)",
        quantity_g: 300,
        estimated_macros_per_100g: {
          calories_per_100g: 389,
          protein_per_100g: 16.9,
          carbs_per_100g: 66.3,
          fat_per_100g: 6.9,
          is_estimated: false,
        },
      },
      { supabase }
    );

    expect(postUrl).toContain("on_conflict=normalized_name");
    expect(preferHeader).toContain("resolution=merge-duplicates");
  });

  it("GeminiProvider supports comma-separated GEMINI_MODEL fallback on 429/503 and strips thinkingConfig when a lite model returns 400 INVALID_ARGUMENT", async () => {
    const { GeminiProvider, resetGeminiModelStateForTests } = await import(
      "@/lib/ai/provider"
    );
    resetGeminiModelStateForTests({ clearPreseeded: true });

    const quota429 = Object.assign(
      new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'),
      { status: 429 }
    );
    const invalidThinking400 = Object.assign(
      new Error(
        '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'
      ),
      { status: 400 }
    );

    const mockGenerateContent = vi
      .fn()
      // 1st call: primary model ("gemini-3.1-flash-lite") hits 429 quota
      .mockRejectedValueOnce(quota429)
      // 2nd call: fallback model ("gemini-3.5-flash-lite") rejects thinkingBudget: 0 with 400 INVALID_ARGUMENT
      .mockRejectedValueOnce(invalidThinking400)
      // 3rd call: fallback model ("gemini-3.5-flash-lite") retried without thinkingConfig succeeds
      .mockResolvedValueOnce({
        text: JSON.stringify({
          items: [
            {
              normalized_name: "oats, dry",
              display_name: "Oats (Dry)",
              quantity: 300,
              unit: "gms",
              quantity_g: 300,
              estimated_macros_per_100g: {
                calories_per_100g: 389,
                protein_per_100g: 16.9,
                carbs_per_100g: 66.3,
                fat_per_100g: 6.9,
                is_estimated: false,
              },
            },
          ],
        }),
      });

    const provider = new GeminiProvider({
      model: "gemini-3.1-flash-lite, gemini-3.5-flash-lite",
      client: { models: { generateContent: mockGenerateContent } },
      retryDelayMs: 1,
    });

    const items = await provider.parseMealText("300 gms oats");
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(mockGenerateContent.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini-3.1-flash-lite",
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    expect(mockGenerateContent.mock.calls[1]?.[0]).toMatchObject({
      model: "gemini-3.5-flash-lite",
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    expect(mockGenerateContent.mock.calls[2]?.[0]).toMatchObject({
      model: "gemini-3.5-flash-lite",
      config: {
        responseMimeType: "application/json",
      },
    });
    expect(
      (
        mockGenerateContent.mock.calls[2]?.[0] as {
          config?: Record<string, unknown>;
        }
      )?.config?.thinkingConfig
    ).toBeUndefined();
    expect(items).toHaveLength(1);
  });

  it("GeminiProvider pre-seeds flash-lite models in module-scoped modelsWithoutThinkingConfig so new instances make only 1 HTTP call without a wasted 400 round-trip", async () => {
    const { GeminiProvider, resetGeminiModelStateForTests } = await import(
      "@/lib/ai/provider"
    );
    resetGeminiModelStateForTests();

    const mockGenerateContent = vi.fn().mockResolvedValueOnce({
      text: JSON.stringify({
        items: [
          {
            normalized_name: "oats, dry",
            display_name: "Oats (Dry)",
            quantity: 300,
            unit: "gms",
            quantity_g: 300,
            estimated_macros_per_100g: {
              calories_per_100g: 389,
              protein_per_100g: 16.9,
              carbs_per_100g: 66.3,
              fat_per_100g: 6.9,
              is_estimated: false,
            },
          },
        ],
      }),
    });

    const provider = new GeminiProvider({
      model: "gemini-3.5-flash-lite",
      client: { models: { generateContent: mockGenerateContent } },
      retryDelayMs: 1,
    });

    const items = await provider.parseMealText("300 gms oats");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(
      (
        mockGenerateContent.mock.calls[0]?.[0] as {
          config?: Record<string, unknown>;
        }
      )?.config?.thinkingConfig
    ).toBeUndefined();
    expect(items).toHaveLength(1);
  });

  it("tryResolveMealTextFromCache() resolves cached single-state and dual-variant meals from the foods table with 0 Gemini calls", async () => {
    const { createServiceSupabaseClient } = await import(
      "@/lib/supabase/service"
    );
    const { tryResolveMealTextFromCache } = await import(
      "@/lib/nutrition/resolve-food"
    );

    const dbHarness = createMockFoodsSupabaseClient([
      {
        id: "f00d0000-0000-4000-8000-000000000010",
        normalized_name: "oats, dry",
        display_name: "Oats (Dry)",
        calories_per_100g: 389,
        protein_per_100g: 16.9,
        carbs_per_100g: 66.3,
        fat_per_100g: 6.9,
        source: "gemini",
        external_id: null,
        is_estimated: false,
        created_at: "2026-10-10T10:00:00Z",
      },
      {
        id: "f00d0000-0000-4000-8000-000000000011",
        normalized_name: "oats, cooked",
        display_name: "Oats (Cooked)",
        calories_per_100g: 71,
        protein_per_100g: 2.5,
        carbs_per_100g: 12,
        fat_per_100g: 1.5,
        source: "gemini",
        external_id: null,
        is_estimated: false,
        created_at: "2026-10-10T10:00:00Z",
      },
      {
        id: "f00d0000-0000-4000-8000-000000000012",
        normalized_name: "dal tadka",
        display_name: "Dal Tadka",
        calories_per_100g: 110,
        protein_per_100g: 5.5,
        carbs_per_100g: 14,
        fat_per_100g: 3.5,
        source: "gemini",
        external_id: null,
        is_estimated: true,
        created_at: "2026-10-10T10:00:00Z",
      },
      {
        id: "f00d0000-0000-4000-8000-000000000013",
        normalized_name: "roti",
        display_name: "Roti",
        calories_per_100g: 297,
        protein_per_100g: 9.8,
        carbs_per_100g: 55.8,
        fat_per_100g: 3.7,
        source: "gemini",
        external_id: null,
        is_estimated: true,
        created_at: "2026-10-10T10:00:00Z",
      },
    ]);
    const supabase = createServiceSupabaseClient({
      fetch: dbHarness.mockFetch,
    });

    // 1. Ambiguous dry pantry staple with both variants cached ("300 gms oats")
    const oatsResult = await tryResolveMealTextFromCache(
      "300 gms oats",
      supabase
    );
    expect(oatsResult).not.toBeNull();
    expect(oatsResult).toHaveLength(1);
    expect(oatsResult?.[0]).toMatchObject({
      food_id: "f00d0000-0000-4000-8000-000000000010",
      food_name: "Oats (Dry)",
      quantity_g: 300,
      calories: 1167,
      selected_state: "dry",
    });
    expect(oatsResult?.[0]?.variants).toHaveLength(2);

    // 2. Multi-item household unit meal ("2 katori dal tadka and 2 rotis")
    const comboResult = await tryResolveMealTextFromCache(
      "2 katori dal tadka and 2 rotis",
      supabase
    );
    expect(comboResult).not.toBeNull();
    expect(comboResult).toHaveLength(2);
    expect(comboResult?.[0]).toMatchObject({
      food_id: "f00d0000-0000-4000-8000-000000000012",
      food_name: "Dal Tadka",
      quantity_g: 300,
      calories: 330,
    });
    expect(comboResult?.[1]).toMatchObject({
      food_id: "f00d0000-0000-4000-8000-000000000013",
      food_name: "Roti",
      quantity_g: 70,
      calories: 207.9,
    });
  });
});




