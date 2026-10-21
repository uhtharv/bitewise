-- Bitewise Database A (Food Reference DB) Schema
-- Read-heavy ~300 MB static catalog hosted on PostgreSQL (Supabase Free Tier)
-- USDA FoodData Central + ICMR-NIN IFCT 2017 / INDB + Open Food Facts

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS reference_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name text NOT NULL,
  display_name text NOT NULL,
  brand text NULL,
  source text NOT NULL CHECK (source IN ('usda', 'ifct', 'openfoodfacts', 'gemini')),
  external_id text NULL,
  search_aliases text[] NULL,
  calories_per_100g numeric(8,2) NOT NULL CHECK (calories_per_100g >= 0),
  protein_per_100g numeric(8,2) NOT NULL CHECK (protein_per_100g >= 0),
  carbs_per_100g numeric(8,2) NOT NULL CHECK (carbs_per_100g >= 0),
  fat_per_100g numeric(8,2) NOT NULL CHECK (fat_per_100g >= 0),
  fiber_per_100g numeric(8,2) NULL CHECK (fiber_per_100g IS NULL OR fiber_per_100g >= 0),
  serving_sizes jsonb NULL,
  is_estimated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Trigram index for fuzzy search across canonical and normalized food names
CREATE INDEX IF NOT EXISTS idx_reference_foods_normalized_trgm
  ON reference_foods USING gin (normalized_name gin_trgm_ops);

-- Trigram index on display_name for user-friendly searches
CREATE INDEX IF NOT EXISTS idx_reference_foods_display_trgm
  ON reference_foods USING gin (display_name gin_trgm_ops);

-- Immutable wrapper for array_to_string (PostgreSQL's built-in array_to_string is STABLE,
-- which causes error 42P17 when used directly inside index expressions)
CREATE OR REPLACE FUNCTION immutable_array_to_string(arr text[], sep text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT array_to_string(arr, sep);
$$;

-- Full-text search index for exact keyword matching
CREATE INDEX IF NOT EXISTS idx_reference_foods_fts
  ON reference_foods USING gin (
    to_tsvector('english', display_name || ' ' || coalesce(immutable_array_to_string(search_aliases, ' '), ''))
  );

-- Row Level Security: Reference catalog is public read-only
ALTER TABLE reference_foods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reference_foods_public_read" ON reference_foods;
CREATE POLICY "reference_foods_public_read"
  ON reference_foods FOR SELECT TO anon, authenticated
  USING (true);

-- Hybrid search RPC function: pg_trgm similarity + full-text search
CREATE OR REPLACE FUNCTION search_food_reference(
  query_text text,
  min_similarity float DEFAULT 0.35,
  max_results int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  normalized_name text,
  display_name text,
  brand text,
  source text,
  external_id text,
  calories_per_100g numeric,
  protein_per_100g numeric,
  carbs_per_100g numeric,
  fat_per_100g numeric,
  fiber_per_100g numeric,
  serving_sizes jsonb,
  is_estimated boolean,
  similarity_score float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    f.id,
    f.normalized_name,
    f.display_name,
    f.brand,
    f.source,
    f.external_id,
    f.calories_per_100g,
    f.protein_per_100g,
    f.carbs_per_100g,
    f.fat_per_100g,
    f.fiber_per_100g,
    f.serving_sizes,
    f.is_estimated,
    GREATEST(
      similarity(f.normalized_name, lower(trim(query_text))),
      similarity(f.display_name, trim(query_text)),
      word_similarity(lower(trim(query_text)), f.normalized_name)
    )::float AS similarity_score
  FROM reference_foods f
  WHERE
    similarity(f.normalized_name, lower(trim(query_text))) >= min_similarity
    OR similarity(f.display_name, trim(query_text)) >= min_similarity
    OR word_similarity(lower(trim(query_text)), f.normalized_name) >= min_similarity
    OR to_tsvector('english', f.display_name || ' ' || coalesce(immutable_array_to_string(f.search_aliases, ' '), ''))
       @@ websearch_to_tsquery('english', query_text)
  ORDER BY similarity_score DESC
  LIMIT max_results;
$$;

