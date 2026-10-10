-- Bitewise initial schema migration (docs/BACKEND_PRD.md §4 & §5)

-- 4.1 foods (Shared Nutrition Cache)
CREATE TABLE foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  calories_per_100g numeric(8,2) NOT NULL CHECK (calories_per_100g >= 0),
  protein_per_100g numeric(8,2) NOT NULL CHECK (protein_per_100g >= 0),
  carbs_per_100g numeric(8,2) NOT NULL CHECK (carbs_per_100g >= 0),
  fat_per_100g numeric(8,2) NOT NULL CHECK (fat_per_100g >= 0),
  source text NOT NULL CHECK (source IN ('usda', 'gemini')),
  external_id text NULL,
  is_estimated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.2 meal_entries (User Meal Log)
CREATE TABLE meal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT (auth.jwt() ->> 'sub'),
  logged_on date NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  food_id uuid REFERENCES foods(id) ON DELETE SET NULL,
  food_name text NOT NULL,
  quantity_g numeric(8,2) NOT NULL CHECK (quantity_g > 0),
  calories numeric(8,2) NOT NULL CHECK (calories >= 0),
  protein_g numeric(8,2) NOT NULL CHECK (protein_g >= 0),
  carbs_g numeric(8,2) NOT NULL CHECK (carbs_g >= 0),
  fat_g numeric(8,2) NOT NULL CHECK (fat_g >= 0),
  is_estimated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meal_entries_user_date ON meal_entries (user_id, logged_on);

-- 4.3 user_settings (User Goals & Timezone)
CREATE TABLE user_settings (
  user_id text PRIMARY KEY DEFAULT (auth.jwt() ->> 'sub'),
  calorie_goal integer NULL CHECK (calorie_goal IS NULL OR calorie_goal > 0),
  protein_goal_g integer NULL CHECK (protein_goal_g IS NULL OR protein_goal_g >= 0),
  carbs_goal_g integer NULL CHECK (carbs_goal_g IS NULL OR carbs_goal_g >= 0),
  fat_goal_g integer NULL CHECK (fat_goal_g IS NULL OR fat_goal_g >= 0),
  timezone text NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4.4 ai_usage (Daily Rate Limit Counter)
CREATE TABLE ai_usage (
  user_id text NOT NULL,
  usage_date date NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, usage_date)
);

-- 5. Row Level Security (RLS)
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- meal_entries: user-owned access only
CREATE POLICY "meal_entries_user_isolation"
  ON meal_entries FOR ALL TO authenticated USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- user_settings: user-owned access only
CREATE POLICY "user_settings_user_isolation"
  ON user_settings FOR ALL TO authenticated USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- foods: authenticated users may SELECT; writes happen on server via service role
CREATE POLICY "foods_authenticated_select"
  ON foods FOR SELECT TO authenticated USING (true);

