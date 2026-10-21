/**
 * Bitewise Database A (Food Reference DB) Ingestion Runner
 * Bulk loads normalized items from USDA, IFCT 2017, and Open Food Facts into PostgreSQL reference_foods.
 */

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { IFCT_CORE_DATASET } from "./data/ifct-dataset.ts";
import { PACKAGED_CORE_DATASET } from "./data/packaged-dataset.ts";
import { USDA_CORE_DATASET } from "./data/usda-dataset.ts";
import type { NormalizedReferenceFood } from "./sources/usda.ts";

export interface IngestOptions {
  supabaseUrl: string;
  supabaseKey: string;
  batchSize?: number;
  onProgress?: (insertedCount: number, totalCount: number) => void;
}

export function deduplicateFoods(items: NormalizedReferenceFood[]): NormalizedReferenceFood[] {
  const seen = new Set<string>();
  const unique: NormalizedReferenceFood[] = [];

  for (const item of items) {
    const key = item.normalized_name.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

export async function ingestReferenceFoods(
  items: NormalizedReferenceFood[],
  options: IngestOptions
): Promise<{ inserted: number; errors: number }> {
  const supabase = createClient(options.supabaseUrl, options.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const batchSize = options.batchSize ?? 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize).map((item) => ({
      normalized_name: item.normalized_name,
      display_name: item.display_name,
      brand: item.brand,
      source: item.source,
      external_id: item.external_id,
      search_aliases: item.search_aliases,
      calories_per_100g: item.calories_per_100g,
      protein_per_100g: item.protein_per_100g,
      carbs_per_100g: item.carbs_per_100g,
      fat_per_100g: item.fat_per_100g,
      fiber_per_100g: item.fiber_per_100g,
      serving_sizes: item.serving_sizes,
      is_estimated: item.is_estimated,
    }));

    const { error } = await supabase
      .from("reference_foods")
      .insert(chunk);

    if (error) {
      console.error(`Batch [${i}..${i + chunk.length}] error: ${error.message}`);
      errors += chunk.length;
    } else {
      inserted += chunk.length;
    }

    if (options.onProgress) {
      options.onProgress(inserted, items.length);
    }
  }

  return { inserted, errors };
}

// Standalone CLI runner entrypoint
const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const url = process.env.FOOD_DATABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.FOOD_DATABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.FOOD_DATABASE_ANON_KEY;

  if (!url || !key) {
    console.error("Missing FOOD_DATABASE_URL and key environment variables.");
    process.exit(1);
  }

  console.log(`[ETL] Connecting to Database A at: ${url}`);

  const rawCombined = [
    ...IFCT_CORE_DATASET,
    ...USDA_CORE_DATASET,
    ...PACKAGED_CORE_DATASET,
  ];

  const uniqueItems = deduplicateFoods(rawCombined);

  console.log(`[ETL] Prepared ${uniqueItems.length} reference food items across IFCT, USDA, and Open Food Facts.`);
  console.log("[ETL] Ingesting items into reference_foods table...");

  ingestReferenceFoods(uniqueItems, {
    supabaseUrl: url,
    supabaseKey: key,
    batchSize: 25,
    onProgress: (inserted, total) => {
      console.log(`[ETL] Progress: ${inserted}/${total} items processed...`);
    },
  })
    .then(({ inserted, errors }) => {
      console.log(`[ETL] Ingestion finished. Successfully inserted: ${inserted}, Errors: ${errors}`);
      if (errors > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[ETL] Fatal error during ingestion:", err);
      process.exit(1);
    });
}
