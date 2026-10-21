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
  type CandidateIngredient,
  type MacroPer100g,
  type ParsedMealItem,
  type PreparationState,
} from "@/lib/ai/provider";
import {
  createFoodReferenceClient,
  searchFoodReference,
  type ReferenceFoodMatch,
} from "@/lib/supabase/food-db";
import { type UsdaFoodMatch } from "@/lib/nutrition/usda";
import type { Database, FoodSource } from "@/lib/supabase/user";

export interface ResolvedMealVariant {
  state: PreparationState;
  label: string;
  food_id: string | null;
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
  food_id: string | null;
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

export type ResolvedFoodNutrientRow = {
  id: string | null;
  normalized_name: string;
  display_name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  source: FoodSource;
  external_id: string | null;
  is_estimated: boolean;
  created_at: string;
};

export interface ResolveFoodDependencies {
  supabase?: SupabaseClient<Database>;
  foodDbClient?: SupabaseClient;
  searchFoodRef?: typeof searchFoodReference;
  lookupUsdaFood?: (query: string) => Promise<UsdaFoodMatch | null>;
  aiProvider?: AIProvider;
  inFlightFoods?: Map<string, Promise<{ food: ResolvedFoodNutrientRow; fromCache: boolean }>>;
}

/**
 * Deterministic business logic serving multiplication:
 * Nutrient Value = round((Nutrient per 100g * Portion Weight) / 100, 1)
 */
export function scaleMacro(per100g: number, quantityG: number): number {
  return Math.round(((per100g * quantityG) / 100) * 10) / 10;
}

function toResolvedMealItem(
  food: {
    id: string | null;
    display_name: string;
    calories_per_100g: number;
    protein_per_100g: number;
    carbs_per_100g: number;
    fat_per_100g: number;
    is_estimated?: boolean;
  },
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

/**
 * Resolves food nutrition using the two-tier Hybrid LLM-to-Database Pipeline:
 * Tier 1: Search Database A (USDA + IFCT + Open Food Facts) via pg_trgm + FTS (min confidence 0.35).
 * Tier 2 Fallback A: Predictive Deconstruction into base ingredients in Database A.
 * Tier 2 Fallback B: Emergency AI estimate explicitly flagged is_estimated = true.
 */
async function resolveNutrientsFromHybridPipeline(
  query: string,
  normalizedName: string,
  displayName: string,
  candidateIngredients: CandidateIngredient[] | undefined,
  inlineMacros: MacroPer100g | undefined,
  deps?: ResolveFoodDependencies
): Promise<{
  id: string | null;
  display_name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated: boolean;
}> {
  const searchFn = deps?.searchFoodRef ?? searchFoodReference;
  const foodDbClient =
    deps?.foodDbClient ??
    (deps?.supabase ? (deps.supabase as unknown as SupabaseClient) : createFoodReferenceClient());


  // Tier 1: Database A Hybrid Search
  try {
    const matches = await searchFn(query, {
      client: foodDbClient,
      minSimilarity: 0.35,
    });

    if (matches && matches.length > 0 && matches[0].similarity_score >= 0.35) {
      const topMatch = matches[0];
      return {
        id: topMatch.id,
        display_name: topMatch.display_name || displayName,
        calories_per_100g: Number(topMatch.calories_per_100g),
        protein_per_100g: Number(topMatch.protein_per_100g),
        carbs_per_100g: Number(topMatch.carbs_per_100g),
        fat_per_100g: Number(topMatch.fat_per_100g),
        is_estimated: Boolean(topMatch.is_estimated),
      };
    }
  } catch {
    // If Database A RPC is unavailable or errored, proceed to legacy cache or fallback
  }

  // Legacy foods table check in deps.supabase (for backward compatibility in existing tests)
  if (deps?.supabase) {
    try {
      const { data: cachedRows } = await deps.supabase
        .from("foods")
        .select("*")
        .eq("normalized_name", normalizedName);

      if (cachedRows && cachedRows.length > 0) {
        const row = cachedRows[0];
        return {
          id: row.id,
          display_name: row.display_name,
          calories_per_100g: Number(row.calories_per_100g),
          protein_per_100g: Number(row.protein_per_100g),
          carbs_per_100g: Number(row.carbs_per_100g),
          fat_per_100g: Number(row.fat_per_100g),
          is_estimated: Boolean(row.is_estimated),
        };
      }
    } catch {
      // Table may not exist if dropped
    }
  }

  // Tier 2 Fallback A: Predictive Deconstruction against Database A
  if (candidateIngredients && candidateIngredients.length > 0) {
    try {
      const ingredientLookups = await Promise.all(
        candidateIngredients.map((ing) =>
          searchFn(ing.normalized_query || ing.name, {
            client: foodDbClient,
            minSimilarity: 0.35,
          }).catch(() => [] as ReferenceFoodMatch[])
        )
      );

      const allMatched = ingredientLookups.every(
        (res) => res && res.length > 0 && res[0].similarity_score >= 0.35
      );

      if (allMatched) {
        let totalCal = 0;
        let totalProt = 0;
        let totalCarb = 0;
        let totalFat = 0;
        let totalWeight = 0;

        candidateIngredients.forEach((ing, i) => {
          const match = ingredientLookups[i][0];
          totalCal += scaleMacro(Number(match.calories_per_100g), ing.quantity_g);
          totalProt += scaleMacro(Number(match.protein_per_100g), ing.quantity_g);
          totalCarb += scaleMacro(Number(match.carbs_per_100g), ing.quantity_g);
          totalFat += scaleMacro(Number(match.fat_per_100g), ing.quantity_g);
          totalWeight += ing.quantity_g;
        });

        if (totalWeight > 0) {
          const per100Multiplier = 100 / totalWeight;
          return {
            id: null,
            display_name: displayName,
            calories_per_100g: Math.round(totalCal * per100Multiplier * 10) / 10,
            protein_per_100g: Math.round(totalProt * per100Multiplier * 10) / 10,
            carbs_per_100g: Math.round(totalCarb * per100Multiplier * 10) / 10,
            fat_per_100g: Math.round(totalFat * per100Multiplier * 10) / 10,
            is_estimated: false,
          };
        }
      }
    } catch {
      // Ingredient matching failed, fall through to emergency AI estimate
    }
  }

  // Tier 2 Fallback B: Emergency AI estimate explicitly flagged is_estimated = true
  const rawEstimate =
    inlineMacros ??
    (await (deps?.aiProvider ?? new GeminiProvider()).estimateMacrosPer100g(
      displayName
    ));

  const estimate = normalizeAndValidateMacrosPer100g(rawEstimate);
  const isEstimated = estimate.is_estimated ?? true;

  // If Database B still has foods table (for backward-compatible tests), cache it
  if (deps?.supabase) {
    try {
      const { data: insertedRows } = await deps.supabase
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

      if (insertedRows && insertedRows.length > 0) {
        const row = insertedRows[0];
        return {
          id: row.id,
          display_name: row.display_name,
          calories_per_100g: Number(row.calories_per_100g),
          protein_per_100g: Number(row.protein_per_100g),
          carbs_per_100g: Number(row.carbs_per_100g),
          fat_per_100g: Number(row.fat_per_100g),
          is_estimated: Boolean(row.is_estimated),
        };
      }
    } catch {
      // Legacy table may not exist
    }
  }

  return {
    id: null,
    display_name: displayName,
    calories_per_100g: estimate.calories_per_100g,
    protein_per_100g: estimate.protein_per_100g,
    carbs_per_100g: estimate.carbs_per_100g,
    fat_per_100g: estimate.fat_per_100g,
    is_estimated: isEstimated,
  };
}

async function resolveSingleNutrientsDeduped(
  query: string,
  normalizedName: string,
  displayName: string,
  candidateIngredients: CandidateIngredient[] | undefined,
  inlineMacros: MacroPer100g | undefined,
  deps?: ResolveFoodDependencies
) {
  let inFlightPromise = deps?.inFlightFoods?.get(normalizedName);
  if (!inFlightPromise) {
    inFlightPromise = (async () => {
      const res = await resolveNutrientsFromHybridPipeline(
        query,
        normalizedName,
        displayName,
        candidateIngredients,
        inlineMacros,
        deps
      );
      return {
        food: {
          id: res.id,
          normalized_name: normalizedName,
          display_name: res.display_name,
          calories_per_100g: res.calories_per_100g,
          protein_per_100g: res.protein_per_100g,
          carbs_per_100g: res.carbs_per_100g,
          fat_per_100g: res.fat_per_100g,
          source: "gemini" as const,
          external_id: null,
          is_estimated: res.is_estimated,
          created_at: new Date().toISOString(),
        },
        fromCache: false,
      };
    })();
    deps?.inFlightFoods?.set(normalizedName, inFlightPromise);
  }
  const result = await inFlightPromise;
  return result.food;
}

/**
 * Resolves a parsed food item (and its optional preparation `variants`)
 * using the two-tier Hybrid LLM-to-Database Pipeline.
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
        const nutrients = await resolveSingleNutrientsDeduped(
          normName,
          normName,
          dispName,
          undefined,
          variant.macros_per_100g,
          deps
        );
        const base = toResolvedMealItem(nutrients, dispName, variant.quantity_g);
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
  const searchQuery = item.normalized_query || normalizedName;

  const nutrients = await resolveSingleNutrientsDeduped(
    searchQuery,
    normalizedName,
    displayName,
    item.candidate_ingredients,
    item.estimated_macros_per_100g,
    deps
  );

  return toResolvedMealItem(nutrients, displayName, item.quantity_g);
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

export interface CachedCandidateFood {
  id: string;
  normalized_name: string;
  display_name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated?: boolean;
}

/**
 * Attempts to resolve clean segments directly from cache (0 Gemini calls)
 */
export async function tryResolveMealTextFromCache(
  text: string,
  supabase?: SupabaseClient<Database>,
  foodDbClient?: SupabaseClient
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
  let rows: CachedCandidateFood[] | null = null;

  try {
    const client =
      foodDbClient ??
      (supabase ? (supabase as unknown as SupabaseClient) : createFoodReferenceClient());
    const { data, error } = await client
      .from("reference_foods")
      .select(
        "id, normalized_name, display_name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_estimated"
      )
      .in("normalized_name", candidateNames);

    if (!error && data && data.length > 0) {
      rows = data.map((r) => ({
        id: String(r.id),
        normalized_name: String(r.normalized_name),
        display_name: String(r.display_name),
        calories_per_100g: Number(r.calories_per_100g),
        protein_per_100g: Number(r.protein_per_100g),
        carbs_per_100g: Number(r.carbs_per_100g),
        fat_per_100g: Number(r.fat_per_100g),
        is_estimated: Boolean(r.is_estimated),
      }));
    }
  } catch {
    // Reference foods lookup failed or unavailable
  }

  if ((!rows || rows.length === 0) && supabase) {
    try {
      const { data, error } = await supabase
        .from("foods")
        .select("*")
        .in("normalized_name", candidateNames);

      if (!error && data && data.length > 0) {
        rows = data.map((r) => ({
          id: r.id,
          normalized_name: r.normalized_name,
          display_name: r.display_name,
          calories_per_100g: Number(r.calories_per_100g),
          protein_per_100g: Number(r.protein_per_100g),
          carbs_per_100g: Number(r.carbs_per_100g),
          fat_per_100g: Number(r.fat_per_100g),
          is_estimated: Boolean(r.is_estimated),
        }));
      }
    } catch {
      // Legacy foods table may not exist
    }
  }

  if (!rows || rows.length === 0) {
    return null;
  }

  const byNormalizedName = new Map<string, CachedCandidateFood>();
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
    const findRow = (suffix?: string): CachedCandidateFood | undefined => {
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

    if (uncookedRow && cookedRow) {
      if (!isExactMassUnit(seg.unit)) {
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

    if (uncookedRow && !cookedRow) {
      return null;
    }

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
