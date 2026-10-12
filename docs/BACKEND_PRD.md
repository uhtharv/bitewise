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
Parses free-text meal description, resolves nutrition via `foods` cache -> Gemini single-pass macros, and returns analyzed items (including optional `dry`/`raw` vs. `cooked` variants when preparation state was unspecified) without saving any meal entry (`FR-2`, `FR-7`).

- **Request Body:**
  ```json
  { "text": "300 gms oats and 2 katori dal tadka" }
  ```
  (`text`: non-empty trimmed string, max 500 chars)
- **Response `200 OK`:**
  ```json
  {
    "items": [
      {
        "food_id": "uuid-dry",
        "food_name": "Oats (Dry)",
        "quantity_g": 300,
        "calories": 1137,
        "protein_g": 39.6,
        "carbs_g": 203.1,
        "fat_g": 19.5,
        "calories_per_100g": 379,
        "protein_per_100g": 13.2,
        "carbs_per_100g": 67.7,
        "fat_per_100g": 6.5,
        "is_estimated": false,
        "selected_state": "dry",
        "variants": [
          {
            "state": "dry",
            "label": "Dry",
            "food_id": "uuid-dry",
            "food_name": "Oats (Dry)",
            "quantity_g": 300,
            "calories": 1137,
            "protein_g": 39.6,
            "carbs_g": 203.1,
            "fat_g": 19.5,
            "calories_per_100g": 379,
            "protein_per_100g": 13.2,
            "carbs_per_100g": 67.7,
            "fat_per_100g": 6.5,
            "is_estimated": false
          },
          {
            "state": "cooked",
            "label": "Cooked",
            "food_id": "uuid-cooked",
            "food_name": "Oats (Cooked)",
            "quantity_g": 300,
            "calories": 213,
            "protein_g": 7.5,
            "carbs_g": 36,
            "fat_g": 4.2,
            "calories_per_100g": 71,
            "protein_per_100g": 2.5,
            "carbs_per_100g": 12,
            "fat_per_100g": 1.4,
            "is_estimated": false
          }
        ]
      }
    ]
  }
  ```
  *(Per-100g fields and optional `variants` allow the Home screen to switch between `Dry`/`Raw` and `Cooked` states and proportionally rescale macros on the client when the user edits `quantity_g` before saving.)*

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
Updates a saved entry's `quantity_g` and proportionally rescales `calories`, `protein_g`, `carbs_g`, and `fat_g` (`FR-5`). When `existing.food_id` is non-null and the referenced `foods` row exists, rescales directly from the `foods` row's `*_per_100g` columns with 1-decimal rounding (`Math.round(((per100g * newQuantityG) / 100) * 10) / 10`) to prevent small-quantity zero-locking and compound rounding drift; falls back to `oldMacro / oldQuantityG` only when `food_id` is null or missing.

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
export type PreparationState = "dry" | "raw" | "cooked";

export interface ParsedMealVariant {
  state: PreparationState;
  label: string;
  normalized_name: string;
  display_name: string;
  quantity_g: number;
  macros_per_100g: MacroPer100g;
}

export interface ParsedMealItem {
  normalized_name: string;
  display_name: string;
  quantity_g: number;
  quantity?: number;
  unit?: string;
  estimated_macros_per_100g?: MacroPer100g;
  selected_state?: PreparationState;
  variants?: ParsedMealVariant[];
}

export interface MacroPer100g {
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated?: boolean;
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
2. **Step 1 — Parse Meal Text & Single-Pass Macros (`AIProvider.parseMealText`):**
   - Call Gemini (`process.env.GEMINI_MODEL`, which accepts a single model ID or comma-separated fallback model IDs such as `gemini-3.5-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.1-flash-lite`) with `thinkingConfig: { thinkingBudget: 0 }` (automatically stripped if a lite model returns `400 INVALID_ARGUMENT`), bounded exponential-backoff retry on transient `503`/`5xx`/network errors, sequential model fallback on `429`/`503`, and structured JSON output (`zod` validated).
   - Accepts English, regional/Indian dish names, and Hinglish.
   - **Unit normalization (`normalizeHouseholdUnitToGrams`):**
     - Deterministic server multipliers apply **only** to exact weight/spoon units (`g`, `gm`, `gms`, `gram`, `grams`, `kg`, `kilogram`, `kilograms`, `oz`, `ounce`, `ounces`, `lb`, `pound`, `pounds`, `ml`, `tbsp`, `tablespoon`, `tablespoons`, `tsp`, `teaspoon`, `teaspoons`).
     - For food-dependent household units (`cup`, `katori`, `bowl`, `roti`, `chapati`, `paratha`, `slice`, `egg`, `idli`, `dosa`, `piece`, `scoop`), trust Gemini's context-aware `quantity_g` first and use reference weights only as a fallback when `quantity_g` is omitted.
   - **State-specific `normalized_name` & Ambiguous State Variants:**
     - `normalized_name` must always include the preparation state (`"oats, dry"` vs `"oats, cooked"`, `"white rice, cooked"` vs `"white rice, raw"`).
     - When a food can be logged as either `dry`/`raw` or `cooked` and the user did not explicitly specify the state in the text, Gemini returns both `variants` (each with its own state-specific `normalized_name`, `display_name`, default `quantity_g`, and `macros_per_100g`), setting `selected_state` to `"dry"` for gram-weighed dry pantry staples like oats (`"300 gms oats"`) and `"cooked"` for meal items/volume units (`"200g rice"`, `"1 cup oats"`).
   - **`is_estimated` Classification:**
     - Gemini sets `is_estimated = false` for standard single-ingredient staples with well-defined reference macros (e.g., oats, eggs, plain rice, chicken breast, milk, banana) and `is_estimated = true` for prepared/composite dishes and recipes (e.g., dal tadka, paneer butter masala, biryani).
   - **Physical & Atwater Math Validation:**
     - Reject any per-100g macro set where `protein_per_100g + carbs_per_100g + fat_per_100g > 105`, any single macro `> 100`, or `calories_per_100g > 900`.
     - Compute Atwater calories `atwater = 4 * protein_per_100g + 4 * carbs_per_100g + 9 * fat_per_100g`. If `calories_per_100g` drifts from `atwater` by more than `20%` and `> 30 kcal`, auto-correct `calories_per_100g = round(atwater, 1)`.
   - If Gemini returns an empty item list or unparseable/invalid output, return `422 UNPROCESSABLE_ENTITY` (without incrementing `ai_usage`).
3. **Step 2 — Quota Increment & Cache Lookup/Persistence (`ai_usage` + `foods` table, parallelized via `Promise.all` with `normalized_name` deduplication):**
   - Once `parseMealText` succeeds, run the `ai_usage` increment write concurrently (`Promise.all`) with resolving all parsed items.
   - For each item (and each of its `variants`, if present), query `foods` by `normalized_name` (lowercase, trimmed).
   - On cache hit, use the cached per-100g macros and cached `is_estimated` flag.
   - On cache miss, upsert (`onConflict: "normalized_name"`) the validated Gemini macros into `foods` with `source = 'gemini'` and the item's `is_estimated` boolean (no live USDA API call).
4. **Step 3 — Scale to `quantity_g`:**
   - Compute item and variant macros as `round((macro_per_100g * quantity_g) / 100, 1)` and return the response without writing to `meal_entries`.



