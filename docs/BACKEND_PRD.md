# Bitewise: Backend PRD

**Status labels:** **LOCKED** (owner decided, follow exactly) · **PROPOSED** (build as written, keep configurable, report it) · **UNDECIDED** (do not build, ask the owner). See `AGENTS.md` section 2.
**Related:** `docs/PRD.md` (product), `docs/FRONTEND_PRD.md` (UI and client data contract).

## 1. Stack and Approved Dependencies **[LOCKED]**

- **Framework:** Next.js App Router (`/app/api/...` Route Handlers)
- **Authentication:** Clerk (`@clerk/nextjs`) with Google sign-in. Open to any Google account; usage is bounded by per-user daily AI rate limits.
- **Database:** Supabase Postgres (`@supabase/supabase-js`) with Row Level Security (RLS) enabled on every table.
- **AI SDK:** Google Gen AI SDK (`@google/genai`), hidden behind `lib/ai/provider.ts`.
- **Validation:** `zod` for all API request inputs and external/AI response parsing.
- **Client State (Frontend):** `@tanstack/react-query`
- **Testing:** `vitest`

Do not add any package not listed here, in `package.json`, or added via the `shadcn` CLI without asking the owner first (`AGENTS.md` section 4).

## 2. Environment Variables **[LOCKED]**

Maintain `.env.example` with variable names only (never commit secrets):

| Variable | Exposure | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Server-only | Google AI Studio API key (free tier) |
| `GEMINI_MODEL` | Server-only | Gemini model ID (`gemini-3.5-flash`). Never hardcode the model ID in code; fail fast if unset |
| `USDA_API_KEY` | Server-only | USDA FoodData Central API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Supabase service-role key (used **only** for `foods` cache and `ai_usage`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase publishable/anon key (used with Clerk session token for RLS) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public | Clerk publishable key |
| `CLERK_SECRET_KEY` | Server-only | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Public | `/sign-in` |

## 3. Auth & Supabase Client Split **[LOCKED]**

1. **Clerk Authentication:** Every `/api/*` route handler verifies the caller with Clerk's `auth()`. If `userId` is missing, return `401 Unauthorized` immediately.
2. **User-Scoped Supabase Client (`lib/supabase/user.ts`):**
   - Uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with Clerk's session token passed via `accessToken` so Postgres RLS policies evaluate `(auth.jwt() ->> 'sub')`.
   - Used for all user-owned data: `meal_entries` and `user_settings`.
3. **Service-Role Supabase Client (`lib/supabase/service.ts`):**
   - Uses `SUPABASE_SERVICE_ROLE_KEY` (server-only).
   - Used **exclusively** for reading/writing the shared `foods` cache and incrementing/checking `ai_usage`.

## 4. Database Schema **[LOCKED]**

All quantities are stored in grams (`quantity_g`). Macros in `foods` are normalized per `100g`.

### 4.1 `foods` (Shared Nutrition Cache)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Internal food ID |
| `normalized_name` | `text` | `NOT NULL UNIQUE` | Lowercase, trimmed canonical food name |
| `display_name` | `text` | `NOT NULL` | Human-readable food name |
| `calories_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (calories_per_100g >= 0)` | kcal per 100g |
| `protein_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (protein_per_100g >= 0)` | Protein (g) per 100g |
| `carbs_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (carbs_per_100g >= 0)` | Carbs (g) per 100g |
| `fat_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (fat_per_100g >= 0)` | Fat (g) per 100g |
| `source` | `text` | `NOT NULL CHECK (source IN ('usda', 'gemini'))` | Origin of nutrition numbers |
| `external_id` | `text` | `NULL` | USDA `fdcId` when `source = 'usda'` |
| `is_estimated` | `boolean` | `NOT NULL DEFAULT false` | `true` whenever `source = 'gemini'` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

### 4.2 `meal_entries` (User Meal Log)
One row per logged food item. Stores a snapshot of computed macros alongside `food_id` so historical logs never shift and rescaling on `PATCH /api/entries/:id` is deterministic.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Entry ID |
| `user_id` | `text` | `NOT NULL DEFAULT (auth.jwt() ->> 'sub')` | Clerk user ID |
| `logged_on` | `date` | `NOT NULL` | Calendar date in user's timezone (`YYYY-MM-DD`) |
| `meal_type` | `text` | `NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack'))` | Meal category |
| `food_id` | `uuid` | `REFERENCES foods(id) ON DELETE SET NULL` | Reference to cached food |
| `food_name` | `text` | `NOT NULL` | Display name of the food item |
| `quantity_g` | `numeric(8,2)` | `NOT NULL CHECK (quantity_g > 0)` | Logged weight in grams |
| `calories` | `numeric(8,2)` | `NOT NULL CHECK (calories >= 0)` | Computed kcal for `quantity_g` |
| `protein_g` | `numeric(8,2)` | `NOT NULL CHECK (protein_g >= 0)` | Computed protein (g) for `quantity_g` |
| `carbs_g` | `numeric(8,2)` | `NOT NULL CHECK (carbs_g >= 0)` | Computed carbs (g) for `quantity_g` |
| `fat_g` | `numeric(8,2)` | `NOT NULL CHECK (fat_g >= 0)` | Computed fat (g) for `quantity_g` |
| `is_estimated` | `boolean` | `NOT NULL DEFAULT false` | `true` if macros came from AI estimation |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

Index: `CREATE INDEX idx_meal_entries_user_date ON meal_entries (user_id, logged_on);`

### 4.3 `user_settings` (User Goals & Timezone)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | `text` | `PRIMARY KEY DEFAULT (auth.jwt() ->> 'sub')` | Clerk user ID |
| `calorie_goal` | `integer` | `NULL CHECK (calorie_goal IS NULL OR calorie_goal > 0)` | Daily calorie target (default `null`) |
| `protein_goal_g` | `integer` | `NULL CHECK (protein_goal_g IS NULL OR protein_goal_g >= 0)` | Daily protein target in g (default `null`) |
| `carbs_goal_g` | `integer` | `NULL CHECK (carbs_goal_g IS NULL OR carbs_goal_g >= 0)` | Daily carbs target in g (default `null`) |
| `fat_goal_g` | `integer` | `NULL CHECK (fat_goal_g IS NULL OR fat_goal_g >= 0)` | Daily fat target in g (default `null`) |
| `timezone` | `text` | `NOT NULL DEFAULT 'UTC'` | IANA timezone string (e.g. `Asia/Kolkata`) |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Last update timestamp |

### 4.4 `ai_usage` (Daily Rate Limit Counter)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | `text` | `NOT NULL` | Clerk user ID |
| `usage_date` | `date` | `NOT NULL` | UTC date (`YYYY-MM-DD`) |
| `count` | `integer` | `NOT NULL DEFAULT 0 CHECK (count >= 0)` | Number of `/api/analyze` calls made today |
| **PK** | | `PRIMARY KEY (user_id, usage_date)` | Composite primary key |

## 5. Row Level Security (RLS) **[LOCKED]**

RLS is enabled on all four tables:
- `meal_entries`: `FOR ALL TO authenticated USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id)`
- `user_settings`: `FOR ALL TO authenticated USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id)`
- `foods`: RLS enabled with no direct client write policy (accessed on the server via service role). Authenticated users may `SELECT`.
- `ai_usage`: RLS enabled with no direct user access (read/updated exclusively via service role on the server).
- **Mandatory Test (`AGENTS.md` section 4):** Include an automated test proving User A cannot `SELECT`, `UPDATE`, or `DELETE` User B's rows in `meal_entries` or `user_settings`.

## 6. API Endpoints Contract **[LOCKED]**

All endpoints validate inputs with `zod` and return JSON.

### Error Status Codes **[LOCKED]**
| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | Zod validation failed (invalid body, query param, or ID) |
| `401` | `UNAUTHORIZED` | Missing or invalid Clerk session |
| `404` | `NOT_FOUND` | Entry not found (or belongs to another user under RLS) |
| `422` | `UNPROCESSABLE_ENTITY` | Gemini could not parse the input text into food items |
| `429` | `RATE_LIMITED` | User reached the daily limit of 30 `/api/analyze` requests |
| `502` | `UPSTREAM_ERROR` | Gemini, USDA, or Supabase upstream request failed |

### 6.1 `POST /api/analyze`
Parses free-text meal description, resolves nutrition via cache -> USDA -> Gemini fallback, and returns analyzed items without saving any meal entry (`FR-2`, `FR-7`).

- **Request Body:**
  ```json
  { "text": "2 katori dal tadka and 2 rotis" }
  ```
  (`text`: non-empty trimmed string, max 500 chars)
- **Response `200 OK`:**
  ```json
  {
    "items": [
      {
        "food_id": "uuid",
        "food_name": "Dal Tadka",
        "quantity_g": 300,
        "calories": 330,
        "protein_g": 16.5,
        "carbs_g": 42,
        "fat_g": 10.5,
        "calories_per_100g": 110,
        "protein_per_100g": 5.5,
        "carbs_per_100g": 14,
        "fat_per_100g": 3.5,
        "is_estimated": true
      }
    ]
  }
  ```
  *(Per-100g fields allow the Home screen to proportionally rescale macros on the client when the user edits `quantity_g` before saving.)*

### 6.2 `POST /api/entries`
Saves one or more analyzed food items to the user's daily meal log (`FR-3`).

- **Request Body:**
  ```json
  {
    "logged_on": "2026-10-10",
    "meal_type": "lunch",
    "items": [
      {
        "food_id": "uuid",
        "food_name": "Dal Tadka",
        "quantity_g": 300,
        "calories": 330,
        "protein_g": 16.5,
        "carbs_g": 42,
        "fat_g": 10.5,
        "is_estimated": true
      }
    ]
  }
  ```
- **Response `201 Created`:**
  ```json
  { "entries": [ /* inserted meal_entries rows */ ] }
  ```

### 6.3 `PATCH /api/entries/:id`
Updates a saved entry's `quantity_g` and proportionally rescales `calories`, `protein_g`, `carbs_g`, and `fat_g` (`FR-5`).

- **Request Body:**
  ```json
  { "quantity_g": 225 }
  ```
- **Response `200 OK`:**
  ```json
  { "entry": { /* updated meal_entries row */ } }
  ```

### 6.4 `DELETE /api/entries/:id`
Deletes a saved entry belonging to the authenticated user (`FR-5`).

- **Response `200 OK`:**
  ```json
  { "deleted": true }
  ```

### 6.5 `GET /api/summary?date=YYYY-MM-DD`
Returns the day's logged entries, computed day totals, and the user's current goals for `/today` (`FR-4`, `FR-6`, `FR-7`).

- **Response `200 OK`:**
  ```json
  {
    "date": "2026-10-10",
    "entries": [ /* meal_entries rows for date ordered by created_at asc */ ],
    "totals": {
      "calories": 330,
      "protein_g": 16.5,
      "carbs_g": 42,
      "fat_g": 10.5
    },
    "goals": {
      "calorie_goal": null,
      "protein_goal_g": null,
      "carbs_goal_g": null,
      "fat_goal_g": null,
      "timezone": "Asia/Kolkata"
    }
  }
  ```

### 6.6 `GET /api/settings` & `PUT /api/settings`
Reads or upserts the authenticated user's daily calorie/macro goals and timezone (`FR-6`).

- **`GET /api/settings` Response `200 OK`:**
  ```json
  {
    "settings": {
      "calorie_goal": null,
      "protein_goal_g": null,
      "carbs_goal_g": null,
      "fat_goal_g": null,
      "timezone": "UTC"
    }
  }
  ```
- **`PUT /api/settings` Request Body:**
  ```json
  {
    "calorie_goal": 2000,
    "protein_goal_g": 140,
    "carbs_goal_g": 220,
    "fat_goal_g": 65,
    "timezone": "Asia/Kolkata"
  }
  ```
  *(Goal fields accept positive integers or `null`.)*

## 7. AI and Nutrition Lookup Pipeline **[LOCKED]**

The AI provider lives behind `lib/ai/provider.ts`:
```ts
export interface ParsedMealItem {
  normalized_name: string;
  display_name: string;
  quantity_g: number;
}

export interface MacroPer100g {
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
}

export interface AIProvider {
  parseMealText(text: string): Promise<ParsedMealItem[]>;
  estimateMacrosPer100g(foodName: string): Promise<MacroPer100g>;
}
```

### Step-by-step execution in `POST /api/analyze`:
1. **Rate Limit Check (`ai_usage`):**
   - Check `ai_usage` for `(userId, current_utc_date)`.
   - If `count >= 30` before increment, reject with `429 RATE_LIMITED`.
   - Run the `ai_usage` increment write concurrently (`Promise.all`) with Step 1 (`parseMealText`).
2. **Step 1 — Parse Meal Text (`AIProvider.parseMealText`):**
   - Call Gemini (`process.env.GEMINI_MODEL`) with `thinkingConfig: { thinkingBudget: 0 }` and structured JSON output (`zod` validated), including inline fallback `estimated_macros_per_100g` per item.
   - Accepts English, regional/Indian dish names, and Hinglish.
   - Normalizes all quantities to grams (`quantity_g`) using a standard reference table in the prompt (e.g., `1 medium katori = 150g`, `1 cup cooked = 200g`, `1 roti/chapati = 35g`, `1 slice bread = 30g`, `1 large egg = 50g`, `1 tbsp = 15g`, `1 tsp = 5g`).
   - If Gemini returns an empty item list or unparseable output, return `422 UNPROCESSABLE_ENTITY`.
3. **Step 2 — Cache Lookup (`foods` table, parallelized via `Promise.all` with `normalized_name` deduplication):**
   - Query `foods` by `normalized_name` (lowercase, trimmed).
   - On cache hit, use the cached per-100g macros and cached `is_estimated` flag.
4. **Step 3 — External Nutrition Lookup (USDA FoodData Central):**
   - On cache miss, query USDA FoodData Central (`GET https://api.nal.usda.gov/fdc/v1/foods/search`, IPv4-first with `autoSelectFamily: false` and a `3.5s` timeout) with `USDA_API_KEY`, preferring `Foundation` and `SR Legacy` data types.
   - Extract per-100g energy (kcal, nutrient `1008` / `2047` / `2048`), protein (`1003`), carbohydrate (`1005`), and total lipid/fat (`1004`).
   - If a valid match with all 4 macro values is found, insert into `foods` with `source = 'usda'` and `is_estimated = false`.
5. **Step 4 — AI Fallback Estimation (`estimated_macros_per_100g` / `AIProvider.estimateMacrosPer100g`):**
   - If USDA has no match, times out, or is unreachable, use the inline fallback `estimated_macros_per_100g` from `parseMealText` (or call `estimateMacrosPer100g` if absent).
   - Insert into `foods` with `source = 'gemini'` and `is_estimated = true`.
6. **Step 5 — Scale to `quantity_g`:**
   - Compute item macros as `round((macro_per_100g * quantity_g) / 100, 1)` and return the response without writing to `meal_entries`.


