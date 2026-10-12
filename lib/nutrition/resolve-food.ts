import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GeminiProvider,
  isDryPantryStaple,
  isExactMassUnit,
  isKnownHouseholdUnit,
  isPieceFoodUnit,
  normalizeAndValidateMacrosPer100g,
  normalizeHouseholdUnitToGrams,
  type AIProvider,
  type MacroPer100g,
  type ParsedMealItem,
  type PreparationState,
} from "@/lib/ai/provider";
import { type UsdaFoodMatch } from "@/lib/nutrition/usda";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database, FoodRow } from "@/lib/supabase/user";

export interface ResolvedMealVariant {
  state: PreparationState;
  label: string;
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
  selected_state?: PreparationState;
  variants?: ResolvedMealVariant[];
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
  inlineMacros: MacroPer100g | undefined,
  normalizedName: string,
  displayName: string,
  deps?: ResolveFoodDependencies
): Promise<{ food: FoodRow; fromCache: boolean }> {
  const supabase = deps?.supabase ?? createServiceSupabaseClient();

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

  // Step 3: Gemini single-pass macros (or `estimateMacrosPer100g` fallback when inline macros omitted)
  const rawEstimate =
    inlineMacros ??
    (await (deps?.aiProvider ?? new GeminiProvider()).estimateMacrosPer100g(
      displayName
    ));

  const estimate = normalizeAndValidateMacrosPer100g(rawEstimate);
  const isEstimated = estimate.is_estimated ?? true;

  const { data: insertedGeminiRows, error: insertGeminiError } = await supabase
    .from("foods")
    .upsert(
      {
        normalized_name: normalizedName,
        display_name: displayName,
        calories_per_100g: estimate.calories_per_100g,
        protein_per_100g: estimate.protein_per_100g,
        carbs_per_100g: estimate.carbs_per_100g,
        fat_per_100g: estimate.fat_per_100g,
        source: "gemini",
        external_id: null,
        is_estimated: isEstimated,
      },
      { onConflict: "normalized_name" }
    )
    .select("*");

  if (
    insertGeminiError ||
    !insertedGeminiRows ||
    insertedGeminiRows.length === 0
  ) {
    throw new Error(
      `Failed to cache Gemini food in foods table: ${
        insertGeminiError?.message ?? "No row returned"
      }`
    );
  }

  return { food: insertedGeminiRows[0], fromCache: false };
}

async function resolveSingleFoodRowDeduped(
  inlineMacros: MacroPer100g | undefined,
  normalizedName: string,
  displayName: string,
  deps?: ResolveFoodDependencies
): Promise<{ food: FoodRow; fromCache: boolean }> {
  let rowPromise = deps?.inFlightFoods?.get(normalizedName);
  if (!rowPromise) {
    rowPromise = resolveOrCreateFoodRow(
      inlineMacros,
      normalizedName,
      displayName,
      deps
    );
    deps?.inFlightFoods?.set(normalizedName, rowPromise);
  }
  return rowPromise;
}

/**
 * Resolves a parsed food item (and its optional preparation `variants`) following the locked order of truth (`docs/BACKEND_PRD.md` §7):
 *   1. `foods` cache (by state-specific `normalized_name`)
 *   2. Gemini validated per-100g macros (`source = 'gemini'`, `is_estimated` false for staples / true for composite dishes)
 */
export async function resolveFoodItem(
  item: ParsedMealItem,
  deps?: ResolveFoodDependencies
): Promise<ResolvedMealItem> {
  if (item.variants && item.variants.length >= 2) {
    const resolvedVariants: ResolvedMealVariant[] = await Promise.all(
      item.variants.map(async (variant) => {
        const normName = variant.normalized_name.trim().toLowerCase();
        const dispName = variant.display_name.trim();
        const { food, fromCache } = await resolveSingleFoodRowDeduped(
          variant.macros_per_100g,
          normName,
          dispName,
          deps
        );
        const base = toResolvedMealItem(
          food,
          fromCache ? food.display_name : dispName,
          variant.quantity_g
        );
        return {
          ...base,
          state: variant.state,
          label: variant.label,
        };
      })
    );

    const activeVariant =
      resolvedVariants.find((v) => v.state === item.selected_state) ??
      resolvedVariants[0];

    return {
      food_id: activeVariant.food_id,
      food_name: activeVariant.food_name,
      quantity_g: activeVariant.quantity_g,
      calories: activeVariant.calories,
      protein_g: activeVariant.protein_g,
      carbs_g: activeVariant.carbs_g,
      fat_g: activeVariant.fat_g,
      calories_per_100g: activeVariant.calories_per_100g,
      protein_per_100g: activeVariant.protein_per_100g,
      carbs_per_100g: activeVariant.carbs_per_100g,
      fat_per_100g: activeVariant.fat_per_100g,
      is_estimated: activeVariant.is_estimated,
      selected_state: activeVariant.state,
      variants: resolvedVariants,
    };
  }

  const normalizedName = item.normalized_name.trim().toLowerCase();
  const displayName = item.display_name.trim();

  const { food, fromCache } = await resolveSingleFoodRowDeduped(
    item.estimated_macros_per_100g,
    normalizedName,
    displayName,
    deps
  );

  return toResolvedMealItem(
    food,
    fromCache ? food.display_name : displayName,
    item.quantity_g
  );
}

interface ParsedSimpleSegment {
  quantity: number;
  unit: string;
  quantityG: number;
  bases: string[];
  explicitState?: PreparationState;
}

function singularizeFoodName(name: string): string {
  if (name.endsWith("ies") && name.length > 4) {
    return `${name.slice(0, -3)}y`;
  }
  if (
    name.endsWith("s") &&
    !name.endsWith("ss") &&
    !name.endsWith("oats") &&
    name.length > 3
  ) {
    return name.slice(0, -1);
  }
  return name;
}

function parseSimpleMealSegment(segment: string): ParsedSimpleSegment | null {
  const match = segment
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?(?:\s+(.*))?$/);
  if (!match) {
    return null;
  }

  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const firstWord = (match[2] ?? "").trim();
  const restWords = (match[3] ?? "").trim();
  if (!firstWord) {
    return null;
  }

  let unit: string;
  let foodPhrase: string;

  if (!restWords) {
    if (!isPieceFoodUnit(firstWord)) {
      return null;
    }
    unit = firstWord.toLowerCase();
    foodPhrase = firstWord.toLowerCase();
  } else if (isKnownHouseholdUnit(firstWord)) {
    unit = firstWord.toLowerCase();
    foodPhrase = restWords.toLowerCase();
  } else {
    foodPhrase = `${firstWord} ${restWords}`.toLowerCase();
    const words = foodPhrase.split(/\s+/);
    const lastWord = words[words.length - 1] ?? "";
    if (!isPieceFoodUnit(lastWord)) {
      return null;
    }
    unit = lastWord;
  }

  let explicitState: PreparationState | undefined;
  if (/\b(dry|uncooked)\b/i.test(foodPhrase)) {
    explicitState = "dry";
  } else if (/\braw\b/i.test(foodPhrase)) {
    explicitState = "raw";
  } else if (/\bcooked\b/i.test(foodPhrase)) {
    explicitState = "cooked";
  }

  const baseFood = foodPhrase
    .replace(/\b(dry|uncooked|raw|cooked)\b/gi, "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!baseFood) {
    return null;
  }

  const singularBase = singularizeFoodName(baseFood);
  const bases = Array.from(new Set([baseFood, singularBase].filter(Boolean)));
  const quantityG = normalizeHouseholdUnitToGrams(quantity, unit);
  if (quantityG <= 0) {
    return null;
  }

  return {
    quantity,
    unit,
    quantityG,
    bases,
    explicitState,
  };
}

/**
 * Attempts to resolve a meal description directly from the `foods` cache before calling Gemini.
 * Returns `ResolvedMealItem[]` if every segment in `text` is a clean `<quantity> <unit?> <food>`
 * phrase whose nutrition (including both `dry`/`raw` and `cooked` variants when applicable) is already cached in `foods`.
 * Returns `null` if any segment cannot be resolved from cache so the caller falls back to `AIProvider.parseMealText()`.
 */
export async function tryResolveMealTextFromCache(
  text: string,
  supabase: SupabaseClient<Database>
): Promise<ResolvedMealItem[] | null> {
  const rawSegments = text
    .trim()
    .split(/(?:,|\n|\+|\band\b|&)+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSegments.length === 0) {
    return null;
  }

  const parsedSegments: ParsedSimpleSegment[] = [];
  const candidateNamesSet = new Set<string>();

  for (const raw of rawSegments) {
    const seg = parseSimpleMealSegment(raw);
    if (!seg) {
      return null;
    }
    parsedSegments.push(seg);
    for (const b of seg.bases) {
      candidateNamesSet.add(b);
      candidateNamesSet.add(`${b}, dry`);
      candidateNamesSet.add(`${b}, raw`);
      candidateNamesSet.add(`${b}, cooked`);
    }
  }

  const candidateNames = Array.from(candidateNamesSet);
  const { data: rows, error } = await supabase
    .from("foods")
    .select("*")
    .in("normalized_name", candidateNames);

  if (error || !rows) {
    return null;
  }

  const byNormalizedName = new Map<string, FoodRow>();
  for (const row of rows) {
    if (candidateNamesSet.has(row.normalized_name)) {
      byNormalizedName.set(row.normalized_name, row);
    }
  }

  if (byNormalizedName.size === 0) {
    return null;
  }

  const resolvedItems: ResolvedMealItem[] = [];

  for (const seg of parsedSegments) {
    const findRow = (suffix?: string): FoodRow | undefined => {
      for (const b of seg.bases) {
        const key = suffix ? `${b}, ${suffix}` : b;
        const found = byNormalizedName.get(key);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    if (seg.explicitState) {
      const explicitRow =
        findRow(seg.explicitState) ??
        (seg.explicitState === "dry" ? findRow("raw") : undefined);
      if (!explicitRow) {
        return null;
      }
      resolvedItems.push(
        toResolvedMealItem(explicitRow, explicitRow.display_name, seg.quantityG)
      );
      continue;
    }

    const dryRow = findRow("dry");
    const rawRow = findRow("raw");
    const cookedRow = findRow("cooked");
    const exactRow = findRow();
    const uncookedRow = dryRow ?? rawRow;
    const uncookedState: PreparationState = dryRow ? "dry" : "raw";
    const uncookedLabel = dryRow ? "Dry" : "Raw";

    // Dual-variant cached food (e.g. "oats, dry" + "oats, cooked")
    if (uncookedRow && cookedRow) {
      if (!isExactMassUnit(seg.unit)) {
        // Volume units like "1 cup oats" have distinct dry vs cooked gram weights; let Gemini supply them
        return null;
      }
      const vUncooked: ResolvedMealVariant = {
        ...toResolvedMealItem(
          uncookedRow,
          uncookedRow.display_name,
          seg.quantityG
        ),
        state: uncookedState,
        label: uncookedLabel,
      };
      const vCooked: ResolvedMealVariant = {
        ...toResolvedMealItem(cookedRow, cookedRow.display_name, seg.quantityG),
        state: "cooked",
        label: "Cooked",
      };
      const variants = [vUncooked, vCooked];
      const preferDry = isDryPantryStaple(seg.bases[0] ?? "");
      const active = preferDry ? vUncooked : vCooked;

      resolvedItems.push({
        food_id: active.food_id,
        food_name: active.food_name,
        quantity_g: active.quantity_g,
        calories: active.calories,
        protein_g: active.protein_g,
        carbs_g: active.carbs_g,
        fat_g: active.fat_g,
        calories_per_100g: active.calories_per_100g,
        protein_per_100g: active.protein_per_100g,
        carbs_per_100g: active.carbs_per_100g,
        fat_per_100g: active.fat_per_100g,
        is_estimated: active.is_estimated,
        selected_state: active.state,
        variants,
      });
      continue;
    }

    // If only an uncooked row exists without its cooked counterpart, let Gemini populate both variants
    if (uncookedRow && !cookedRow) {
      return null;
    }

    // If a dry pantry staple only has a cooked row without its dry counterpart, let Gemini populate both
    if (cookedRow && !uncookedRow && isDryPantryStaple(seg.bases[0] ?? "")) {
      return null;
    }

    const singleRow = exactRow ?? (isPieceFoodUnit(seg.unit) ? cookedRow : undefined);
    if (!singleRow) {
      return null;
    }

    resolvedItems.push(
      toResolvedMealItem(singleRow, singleRow.display_name, seg.quantityG)
    );
  }

  return resolvedItems;
}

