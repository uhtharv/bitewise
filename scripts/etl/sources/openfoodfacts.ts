/**
 * Open Food Facts (Indian Packaged Foods) Normalizer
 * Filters items with Indian country tags or 890 barcode prefix (~60,000–100,000 items).
 */

import type { NormalizedReferenceFood } from "./usda";

export interface RawOpenFoodFactsProduct {
  code: string;
  product_name?: string;
  brands?: string;
  countries_tags?: string[];
  nutriments?: {
    "energy-kcal_100g"?: number | string;
    energy_100g?: number | string;
    proteins_100g?: number | string;
    carbohydrates_100g?: number | string;
    fat_100g?: number | string;
    fiber_100g?: number | string;
  };
  categories_tags?: string[];
}

export function isIndianMarketProduct(raw: RawOpenFoodFactsProduct): boolean {
  if (raw.code?.startsWith("890")) {
    return true;
  }
  if (raw.countries_tags) {
    const isIndia = raw.countries_tags.some((tag) =>
      tag.toLowerCase().includes("india")
    );
    if (isIndia) return true;
  }
  return false;
}

export function normalizeOpenFoodFactsProduct(
  raw: RawOpenFoodFactsProduct
): NormalizedReferenceFood | null {
  if (!raw.product_name || !raw.nutriments) {
    return null;
  }

  const n = raw.nutriments;
  const rawCalories = n["energy-kcal_100g"] ?? (n.energy_100g ? Number(n.energy_100g) / 4.184 : 0);
  const calories = Number(rawCalories) || 0;
  const protein = Number(n.proteins_100g) || 0;
  const carbs = Number(n.carbohydrates_100g) || 0;
  const fat = Number(n.fat_100g) || 0;
  const fiber = n.fiber_100g != null ? Number(n.fiber_100g) : null;

  // Reject malformed or impossible nutrient values
  if (protein + carbs + fat > 105 || calories > 900 || calories < 0) {
    return null;
  }

  const brand = raw.brands?.trim() || null;
  const displayName = brand
    ? `${brand} - ${raw.product_name.trim()}`
    : raw.product_name.trim();

  const normalized = `${brand ? brand.toLowerCase() + " " : ""}${raw.product_name.toLowerCase()}`
    .replace(/[^a-z0-9, ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const aliases: string[] = [];
  if (raw.categories_tags) {
    raw.categories_tags.forEach((cat) => {
      const clean = cat.replace(/^[a-z]+:/i, "").replace(/-/g, " ").toLowerCase();
      aliases.push(clean);
    });
  }

  return {
    normalized_name: normalized,
    display_name: displayName,
    brand,
    source: "openfoodfacts",
    external_id: raw.code,
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

