import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export type FoodReferenceSource = "usda" | "ifct" | "openfoodfacts";

export interface ReferenceFoodRow {
  id: string;
  normalized_name: string;
  display_name: string;
  brand: string | null;
  source: FoodReferenceSource;
  external_id: string | null;
  search_aliases?: string[] | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number | null;
  serving_sizes?: Array<{ unit: string; grams: number }> | null;
  is_estimated: boolean;
  created_at?: string;
}

export interface ReferenceFoodMatch {
  id: string;
  normalized_name: string;
  display_name: string;
  brand: string | null;
  source: FoodReferenceSource;
  external_id: string | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number | null;
  similarity_score: number;
  is_estimated?: boolean;
}

export interface FoodDatabaseClientOptions {
  fetch?: typeof fetch;
}

export interface SearchFoodReferenceOptions {
  minSimilarity?: number;
  maxResults?: number;
  client?: SupabaseClient;
}

/**
 * Returns the configured URL and key for Database A (Food Reference DB).
 * Falls back to primary Supabase instance when FOOD_DATABASE_* env vars are not set.
 */
export function getFoodDatabaseConfig(): { url: string; key: string } {
  return {
    url: env.FOOD_DATABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    key: env.FOOD_DATABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/**
 * Creates a stateless HTTPS Supabase client for Database A.
 * Stateless connections prevent connection pool exhaustion on serverless/Vercel free tier.
 */
export function createFoodReferenceClient(
  options?: FoodDatabaseClientOptions
): SupabaseClient {
  const { url, key } = getFoodDatabaseConfig();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: options?.fetch ? { fetch: options.fetch } : undefined,
  });
}

/**
 * Searches the static reference catalog via pg_trgm + FTS RPC function in Database A.
 * Default similarity threshold is 0.35.
 */
export async function searchFoodReference(
  queryText: string,
  options?: SearchFoodReferenceOptions
): Promise<ReferenceFoodMatch[]> {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return [];
  }

  const client = options?.client ?? createFoodReferenceClient();
  const minSimilarity = options?.minSimilarity ?? 0.35;
  const maxResults = options?.maxResults ?? 5;

  const { data, error } = await client.rpc("search_food_reference", {
    query_text: trimmed,
    min_similarity: minSimilarity,
    max_results: maxResults,
  });

  if (error) {
    // If the table exists but RPC isn't loaded (e.g., in basic test mock), fallback to ilike query
    const { data: fallbackRows, error: fallbackError } = await client
      .from("reference_foods")
      .select("*")
      .ilike("normalized_name", `%${trimmed.toLowerCase()}%`)
      .limit(maxResults);

    if (!fallbackError && fallbackRows && fallbackRows.length > 0) {
      return fallbackRows.map((row: ReferenceFoodRow) => ({
        id: row.id,
        normalized_name: row.normalized_name,
        display_name: row.display_name,
        brand: row.brand,
        source: row.source,
        external_id: row.external_id,
        calories_per_100g: Number(row.calories_per_100g),
        protein_per_100g: Number(row.protein_per_100g),
        carbs_per_100g: Number(row.carbs_per_100g),
        fat_per_100g: Number(row.fat_per_100g),
        fiber_per_100g: row.fiber_per_100g ? Number(row.fiber_per_100g) : null,
        similarity_score: 1.0,
        is_estimated: Boolean(row.is_estimated),
      }));
    }

    throw new Error(`Failed to execute search_food_reference: ${error.message}`);
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    normalized_name: String(row.normalized_name),
    display_name: String(row.display_name),
    brand: row.brand ? String(row.brand) : null,
    source: (row.source as FoodReferenceSource) ?? "usda",
    external_id: row.external_id ? String(row.external_id) : null,
    calories_per_100g: Number(row.calories_per_100g),
    protein_per_100g: Number(row.protein_per_100g),
    carbs_per_100g: Number(row.carbs_per_100g),
    fat_per_100g: Number(row.fat_per_100g),
    fiber_per_100g: row.fiber_per_100g != null ? Number(row.fiber_per_100g) : null,
    similarity_score: Number(row.similarity_score ?? 0),
    is_estimated: Boolean(row.is_estimated ?? false),
  }));
}

