-- Bitewise Database B Migration: Drop foods FK, add per-100g snapshots on meal_entries, drop legacy foods table
-- Satisfies Dual-Database segregation: no cross-database foreign keys, historical snapshotting

-- 1. Add per-100g snapshot columns to meal_entries
ALTER TABLE meal_entries
  ADD COLUMN IF NOT EXISTS calories_per_100g numeric(8,2) NULL,
  ADD COLUMN IF NOT EXISTS protein_per_100g numeric(8,2) NULL,
  ADD COLUMN IF NOT EXISTS carbs_per_100g numeric(8,2) NULL,
  ADD COLUMN IF NOT EXISTS fat_per_100g numeric(8,2) NULL;

-- 2. Backfill existing meal_entries from foods table if present
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'foods') THEN
    UPDATE meal_entries m
    SET calories_per_100g = f.calories_per_100g,
        protein_per_100g = f.protein_per_100g,
        carbs_per_100g = f.carbs_per_100g,
        fat_per_100g = f.fat_per_100g
    FROM foods f
    WHERE m.food_id = f.id AND m.calories_per_100g IS NULL;
  END IF;
END $$;

-- 3. Drop foreign key constraint on meal_entries(food_id)
ALTER TABLE meal_entries
  DROP CONSTRAINT IF EXISTS meal_entries_food_id_fkey;

-- 4. Drop legacy foods table from Database B per user decision
DROP TABLE IF EXISTS foods CASCADE;

