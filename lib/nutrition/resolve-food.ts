import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GeminiProvider,
  type AIProvider,
  type ParsedMealItem,
} from "@/lib/ai/provider";
import {
  lookupUsdaFood as defaultLookupUsdaFood,
  type UsdaFoodMatch,
} from "@/lib/nutrition/usda";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database, FoodRow } from "@/lib/supabase/user";

export interface ResolvedMealItem {
  food_id: string;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated: boolean;
}

export interface ResolveFoodDependencies {
  supabase?: SupabaseClient<Database>;
  lookupUsdaFood?: (query: string) => Promise<UsdaFoodMatch | null>;
  aiProvider?: AIProvider;
  inFlightFoods?: Map<string, Promise<{ food: FoodRow; fromCache: boolean }>>;
}

function scaleMacro(per100g: number, quantityG: number): number {
  return Math.round(((per100g * quantityG) / 100) * 10) / 10;
}

function toResolvedMealItem(
  food: FoodRow,
  displayName: string,
  quantityG: number
): ResolvedMealItem {
  const caloriesPer100g = Number(food.calories_per_100g);
  const proteinPer100g = Number(food.protein_per_100g);
  const carbsPer100g = Number(food.carbs_per_100g);
  const fatPer100g = Number(food.fat_per_100g);

  return {
    food_id: food.id,
    food_name: displayName,
    quantity_g: quantityG,
    calories: scaleMacro(caloriesPer100g, quantityG),
    protein_g: scaleMacro(proteinPer100g, quantityG),
    carbs_g: scaleMacro(carbsPer100g, quantityG),
    fat_g: scaleMacro(fatPer100g, quantityG),
    calories_per_100g: caloriesPer100g,
    protein_per_100g: proteinPer100g,
    carbs_per_100g: carbsPer100g,
    fat_per_100g: fatPer100g,
    is_estimated: Boolean(food.is_estimated),
  };
}

async function resolveOrCreateFoodRow(
  item: ParsedMealItem,
  normalizedName: string,
  displayName: string,
  deps?: ResolveFoodDependencies
): Promise<{ food: FoodRow; fromCache: boolean }> {
  const supabase = deps?.supabase ?? createServiceSupabaseClient();
  const lookupUsda = deps?.lookupUsdaFood ?? defaultLookupUsdaFood;

  // Step 2: Cache Lookup (`foods` table)
  const { data: cachedRows, error: cacheError } = await supabase
    .from("foods")
    .select("*")
    .eq("normalized_name", normalizedName);

  if (cacheError) {
    throw new Error(`Failed to query foods cache: ${cacheError.message}`);
  }

  if (cachedRows && cachedRows.length > 0) {
    return { food: cachedRows[0], fromCache: true };
  }

  // Step 3: External Nutrition Lookup (USDA FoodData Central)
  // If USDA times out or fails, fall back gracefully to Gemini estimation (`is_estimated = true`).
  let usdaMatch: UsdaFoodMatch | null = null;
  try {
    usdaMatch = await lookupUsda(normalizedName);
  } catch {
    usdaMatch = null;
  }

  if (usdaMatch) {
    const { data: insertedUsdaRows, error: insertUsdaError } = await supabase
      .from("foods")
      .insert({
        normalized_name: normalizedName,
        display_name: displayName,
        calories_per_100g: usdaMatch.calories_per_100g,
        protein_per_100g: usdaMatch.protein_per_100g,
        carbs_per_100g: usdaMatch.carbs_per_100g,
        fat_per_100g: usdaMatch.fat_per_100g,
        source: "usda",
        external_id: usdaMatch.external_id,
        is_estimated: false,
      })
      .select("*");

    if (insertUsdaError || !insertedUsdaRows || insertedUsdaRows.length === 0) {
      throw new Error(
        `Failed to cache USDA food in foods table: ${
          insertUsdaError?.message ?? "No row returned"
        }`
      );
    }

    return { food: insertedUsdaRows[0], fromCache: false };
  }

  // Step 4: AI Fallback Estimation (`estimated_macros_per_100g` from single-pass parse or `estimateMacrosPer100g`)
  const estimate =
    item.estimated_macros_per_100g ??
    (await (deps?.aiProvider ?? new GeminiProvider()).estimateMacrosPer100g(
      displayName
    ));

  const { data: insertedGeminiRows, error: insertGeminiError } = await supabase
    .from("foods")
    .insert({
      normalized_name: normalizedName,
      display_name: displayName,
      calories_per_100g: estimate.calories_per_100g,
      protein_per_100g: estimate.protein_per_100g,
      carbs_per_100g: estimate.carbs_per_100g,
      fat_per_100g: estimate.fat_per_100g,
      source: "gemini",
      external_id: null,
      is_estimated: true,
    })
    .select("*");

  if (
    insertGeminiError ||
    !insertedGeminiRows ||
    insertedGeminiRows.length === 0
  ) {
    throw new Error(
      `Failed to cache Gemini food estimate in foods table: ${
        insertGeminiError?.message ?? "No row returned"
      }`
    );
  }

  return { food: insertedGeminiRows[0], fromCache: false };
}

/**
 * Resolves a parsed food item following the locked order of truth (`docs/BACKEND_PRD.md` §7):
 *   1. `foods` cache (by `normalized_name`)
 *   2. USDA FoodData Central (`source = 'usda'`, `is_estimated = false`)
 *   3. Gemini fallback estimate (`source = 'gemini'`, `is_estimated = true`)
 */
export async function resolveFoodItem(
  item: ParsedMealItem,
  deps?: ResolveFoodDependencies
): Promise<ResolvedMealItem> {
  const normalizedName = item.normalized_name.trim().toLowerCase();
  const displayName = item.display_name.trim();

  let rowPromise = deps?.inFlightFoods?.get(normalizedName);
  if (!rowPromise) {
    rowPromise = resolveOrCreateFoodRow(item, normalizedName, displayName, deps);
    deps?.inFlightFoods?.set(normalizedName, rowPromise);
  }

  const { food, fromCache } = await rowPromise;
  return toResolvedMealItem(
    food,
    fromCache ? food.display_name : displayName,
    item.quantity_g
  );
}

