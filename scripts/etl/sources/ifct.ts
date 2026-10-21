/**
 * ICMR-NIN (IFCT 2017) & INDB Indian Food Normalizer
 * Standardizes Indian staples, pulses (dals), regional dishes, spices, and Hinglish aliases.
 */

import type { NormalizedReferenceFood } from "./usda";

export interface RawIfctFood {
  code: string;
  name: string;
  scientificName?: string;
  group?: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  regionalNames?: string[];
  aliases?: string[];
}

export function normalizeIfctFood(raw: RawIfctFood): NormalizedReferenceFood | null {
  if (!raw.name || raw.energyKcal == null) {
    return null;
  }

  const aliases = new Set<string>();
  if (raw.group) aliases.add(raw.group.toLowerCase());
  if (raw.regionalNames) {
    raw.regionalNames.forEach((n) => aliases.add(n.toLowerCase().trim()));
  }
  if (raw.aliases) {
    raw.aliases.forEach((a) => aliases.add(a.toLowerCase().trim()));
  }

  const normalized = raw.name
    .toLowerCase()
    .replace(/[^a-z0-9, ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    normalized_name: normalized,
    display_name: raw.name.trim(),
    brand: null,
    source: "ifct",
    external_id: raw.code,
    search_aliases: Array.from(aliases),
    calories_per_100g: Math.round(Number(raw.energyKcal) * 10) / 10,
    protein_per_100g: Math.round(Number(raw.proteinG) * 10) / 10,
    carbs_per_100g: Math.round(Number(raw.carbsG) * 10) / 10,
    fat_per_100g: Math.round(Number(raw.fatG) * 10) / 10,
    fiber_per_100g: raw.fiberG != null ? Math.round(Number(raw.fiberG) * 10) / 10 : null,
    serving_sizes: null,
    is_estimated: false,
  };
}

