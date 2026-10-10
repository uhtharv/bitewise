import dns from "node:dns";
import net from "node:net";
import { z } from "zod";
import { env } from "@/lib/env";

const USDA_REQUEST_TIMEOUT_MS = 3500;

// `api.nal.usda.gov` publishes both A and AAAA records; Node 24's Happy Eyeballs
// interleaves IPv6 AAAA addresses that stall for seconds before falling back.
// Prefer IPv4 first and disable autoSelectFamily so IPv4 connects immediately.
try {
  dns.setDefaultResultOrder("ipv4first");
  if (typeof net.setDefaultAutoSelectFamily === "function") {
    net.setDefaultAutoSelectFamily(false);
  }
} catch {
  // Ignore if unsupported in the current runtime environment.
}

const usdaNutrientSchema = z.object({
  nutrientId: z.number().optional(),
  nutrientNumber: z.union([z.string(), z.number()]).optional(),
  number: z.union([z.string(), z.number()]).optional(),
  value: z.number().optional(),
  amount: z.number().optional(),
  nutrient: z
    .object({
      id: z.number().optional(),
      number: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
});

const usdaFoodItemSchema = z.object({
  fdcId: z.union([z.number(), z.string()]),
  description: z.string(),
  foodNutrients: z.array(usdaNutrientSchema).default([]),
});

const usdaSearchResponseSchema = z.object({
  foods: z.array(usdaFoodItemSchema).default([]),
});

export interface UsdaFoodMatch {
  external_id: string;
  display_name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
}

export interface LookupUsdaOptions {
  apiKey?: string;
  fetch?: typeof fetch;
}

/**
 * Strips Lucene query-syntax operator characters (`+ - ! ( ) { } [ ] ^ " ~ * ? : \ /`)
 * that can cause USDA FoodData Central's search endpoint to return HTTP 400/500.
 */
export function sanitizeUsdaQuery(rawQuery: string): string {
  return rawQuery
    .replace(/[^\p{L}\p{N}\s,]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNutrientValue(
  nutrients: Array<z.infer<typeof usdaNutrientSchema>>,
  ids: number[],
  numbers: string[]
): number | null {
  for (const n of nutrients) {
    const resolvedId = n.nutrientId ?? n.nutrient?.id;
    const rawNum = n.nutrientNumber ?? n.number ?? n.nutrient?.number;
    const resolvedNumber = rawNum !== undefined ? String(rawNum) : undefined;

    const matchedById = resolvedId !== undefined && ids.includes(resolvedId);
    const matchedByNumber =
      resolvedNumber !== undefined && numbers.includes(resolvedNumber);
    if (matchedById || matchedByNumber) {
      const val = n.value ?? n.amount;
      if (typeof val === "number" && val >= 0) {
        return Math.round(val * 100) / 100;
      }
    }
  }
  return null;
}

/**
 * Searches USDA FoodData Central (`GET https://api.nal.usda.gov/fdc/v1/foods/search`)
 * for per-100g macros (`docs/BACKEND_PRD.md` §7 Step 3).
 * Throws an Error when the upstream USDA API fails.
 */
export async function lookupUsdaFood(
  query: string,
  options?: LookupUsdaOptions
): Promise<UsdaFoodMatch | null> {
  const apiKey = (options?.apiKey ?? env.USDA_API_KEY).trim();
  const fetchFn = options?.fetch ?? fetch;
  const sanitizedQuery = sanitizeUsdaQuery(query);
  if (!sanitizedQuery) {
    return null;
  }

  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", sanitizedQuery);
  url.searchParams.set("dataType", "Foundation,SR Legacy");
  url.searchParams.set("pageSize", "5");

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": apiKey,
      },
      signal: AbortSignal.timeout(USDA_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `USDA FoodData Central request failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `USDA FoodData Central returned HTTP ${response.status}`
    );
  }

  const rawBody: unknown = await response.json();
  const parsed = usdaSearchResponseSchema.parse(rawBody);

  for (const food of parsed.foods) {
    const calories = extractNutrientValue(
      food.foodNutrients,
      [1008, 2047, 2048],
      ["208", "957", "958"]
    );
    const protein = extractNutrientValue(
      food.foodNutrients,
      [1003],
      ["203"]
    );
    const carbs = extractNutrientValue(
      food.foodNutrients,
      [1005],
      ["205"]
    );
    const fat = extractNutrientValue(
      food.foodNutrients,
      [1004],
      ["204"]
    );

    if (
      calories !== null &&
      protein !== null &&
      carbs !== null &&
      fat !== null
    ) {
      return {
        external_id: String(food.fdcId),
        display_name: food.description,
        calories_per_100g: calories,
        protein_per_100g: protein,
        carbs_per_100g: carbs,
        fat_per_100g: fat,
      };
    }
  }

  return null;
}

