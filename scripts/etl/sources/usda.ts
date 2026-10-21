/**
 * USDA FoodData Central Normalizer
 * Sources: Foundation Foods, SR Legacy, FNDDS
 * Standardizes raw/cooked variants and maps USDA nutrient numbers to canonical reference schema.
 */

export interface RawUsdaFood {
  fdcId: number | string;
  description: string;
  foodCategory?: string;
  foodNutrients: Array<{
    nutrientId?: number;
    nutrientNumber?: string;
    nutrientName?: string;
    value: number;
    unitName?: string;
  }>;
}

export interface NormalizedReferenceFood {
  normalized_name: string;
  display_name: string;
  brand: string | null;
  source: "usda" | "ifct" | "openfoodfacts";
  external_id: string;
  search_aliases: string[];
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number | null;
  serving_sizes: Array<{ unit: string; grams: number }> | null;
  is_estimated: boolean;
}

const NUTRIENT_IDS = {
  ENERGY_KCAL: [1008, 2047, 2048],
  PROTEIN: [1003],
  CARBS: [1005],
  FAT: [1004],
  FIBER: [1079],
};

export function normalizeUsdaFood(raw: RawUsdaFood): NormalizedReferenceFood | null {
  if (!raw.description || !raw.foodNutrients) {
    return null;
  }

  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fiber: number | null = null;

  for (const n of raw.foodNutrients) {
    const id = Number(n.nutrientId ?? n.nutrientNumber);
    const val = Number(n.value ?? 0);

    if (NUTRIENT_IDS.ENERGY_KCAL.includes(id)) {
      calories = Math.max(calories, val);
    } else if (NUTRIENT_IDS.PROTEIN.includes(id)) {
      protein = val;
    } else if (NUTRIENT_IDS.CARBS.includes(id)) {
      carbs = val;
    } else if (NUTRIENT_IDS.FAT.includes(id)) {
      fat = val;
    } else if (NUTRIENT_IDS.FIBER.includes(id)) {
      fiber = val;
    }
  }

  // Sanity check physical bounds
  if (protein + carbs + fat > 105 || calories > 900) {
    return null;
  }

  const cleanDescription = raw.description
    .replace(/,\s*(raw|dry|cooked)\b/gi, " ($1)")
    .trim();

  const normalized = raw.description
    .toLowerCase()
    .replace(/[^a-z0-9, ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const aliases: string[] = [];
  if (raw.foodCategory) {
    aliases.push(raw.foodCategory.toLowerCase());
  }

  return {
    normalized_name: normalized,
    display_name: cleanDescription,
    brand: null,
    source: "usda",
    external_id: String(raw.fdcId),
    search_aliases: aliases,
    calories_per_100g: Math.round(calories * 10) / 10,
    protein_per_100g: Math.round(protein * 10) / 10,
    carbs_per_100g: Math.round(carbs * 10) / 10,
    fat_per_100g: Math.round(fat * 10) / 10,
    fiber_per_100g: fiber != null ? Math.round(fiber * 10) / 10 : null,
    serving_sizes: null,
    is_estimated: false,
  };
}

