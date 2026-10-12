-- Clear legacy/poisoned USDA and un-suffixed cache entries from shared foods cache
-- Existing meal_entries retain their snapshotted macros and set food_id = NULL via ON DELETE SET NULL
DELETE FROM foods;

