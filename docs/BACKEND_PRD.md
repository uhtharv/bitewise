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
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Supabase service-role key (used **only** for `ai_usage`) |
| `FOOD_DATABASE_URL` | Server-only | Database A (Food Reference DB) URL (falls back to `NEXT_PUBLIC_SUPABASE_URL`) |
| `FOOD_DATABASE_ANON_KEY` | Server-only | Database A (Food Reference DB) anon key (falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Database B Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Database B Supabase publishable/anon key (used with Clerk session token for RLS) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public | Clerk publishable key |
| `CLERK_SECRET_KEY` | Server-only | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Public | `/sign-in` |

## 3. Auth & Supabase Client Split **[LOCKED]**

1. **Clerk Authentication:** Route handlers for user-owned data (`/api/entries`, `/api/summary`, `/api/settings`) verify the caller with Clerk's `auth()`. If `userId` is missing, return `401 Unauthorized` immediately. `/api/analyze` permits both authenticated users and unauthenticated guests (tracked via dual-layer guest cookie and hashed IP in `ai_usage`).
2. **User-Scoped Supabase Client (`lib/supabase/user.ts`):**
   - Uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with Clerk's session token passed via `accessToken` so Postgres RLS policies evaluate `(auth.jwt() ->> 'sub')`.
   - Used for all user-owned data in Database B: `meal_entries` and `user_settings`.
3. **Food Reference Database Client (`lib/supabase/food-db.ts`):**
   - Stateless client using `FOOD_DATABASE_URL` and `FOOD_DATABASE_ANON_KEY` (`auth: { persistSession: false, autoRefreshToken: false }`).
   - Used **exclusively** for read-only trigram and full-text searches against Database A (`reference_foods`).
4. **Service-Role Supabase Client (`lib/supabase/service.ts`):**
   - Uses `SUPABASE_SERVICE_ROLE_KEY` (server-only).
   - Used **exclusively** for incrementing and checking daily rate limits in `ai_usage` for authenticated users and guests.

## 4. Database Schema **[LOCKED]**

All quantities are stored in grams (`quantity_g`). Per-100g macro fields are normalized to 1 decimal place.

The architecture enforces a strict **Dual-Database Segregation**:
1. **Database A (Food Reference DB):** Dedicated read-heavy static catalog (~300 MB) hosted on a separate Supabase project. Contains curated items from USDA FoodData Central, ICMR-NIN (IFCT 2017), and Open Food Facts.
2. **Database B (User & Log DB):** Dynamic, transaction-heavy Supabase instance storing user profiles, daily calorie/macro goals, meal history, and rate limits.
3. **Cross-DB Rule:** **Zero cross-database SQL `JOIN`s.** Historical meal logs snapshot computed macros and per-100g reference values at the time of logging. `PATCH /api/entries/:id` rescales offline directly from snapshotted per-100g values with zero cross-database queries.

---

### 4.1 Database A: `reference_foods` (Static Food Reference Catalog)
`supabase/reference_migrations/0001_reference_schema.sql`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Reference food ID |
| `normalized_name` | `text` | `NOT NULL UNIQUE` | Lowercase trimmed canonical name |
| `display_name` | `text` | `NOT NULL` | Human-readable food name |
| `brand` | `text` | `NULL` | Brand name for packaged items |
| `source` | `text` | `NOT NULL CHECK (source IN ('usda', 'ifct', 'openfoodfacts', 'gemini'))` | Origin catalog |
| `external_id` | `text` | `NULL` | Upstream identifier (FDC ID, IFCT code, barcode) |
| `calories_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (calories_per_100g >= 0)` | kcal per 100g |
| `protein_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (protein_per_100g >= 0)` | Protein (g) per 100g |
| `carbs_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (carbs_per_100g >= 0)` | Carbs (g) per 100g |
| `fat_per_100g` | `numeric(8,2)` | `NOT NULL CHECK (fat_per_100g >= 0)` | Fat (g) per 100g |
| `fiber_per_100g` | `numeric(8,2)` | `NULL CHECK (fiber_per_100g >= 0)` | Dietary fiber (g) per 100g |
| `is_estimated` | `boolean` | `NOT NULL DEFAULT false` | `true` only for emergency AI fallbacks |
| `search_vector` | `tsvector` | `GENERATED ALWAYS AS (to_tsvector('english', display_name)) STORED` | Full-text search vector |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

**Indexes & Search Optimization:**
- Trigram GIN index: `CREATE INDEX idx_reference_foods_trgm ON reference_foods USING gin (display_name gin_trgm_ops);`
- Full-text search index: `CREATE INDEX idx_reference_foods_fts ON reference_foods USING gin (search_vector);`
- Hybrid RPC Search Function: `search_food_reference(query_text, min_similarity, max_results)` combining trigram similarity (`similarity(display_name, query_text)`) and `ts_rank(search_vector, plainto_tsquery('english', query_text))` with a configurable confidence threshold ($\ge 0.35$).

---

### 4.2 Database B: `meal_entries` (User Meal Log)
`supabase/migrations/0003_drop_foods_fk_add_per_100g_snapshots.sql`

Stores a complete snapshot of computed macros and per-100g values so historical logs never shift and rescaling on `PATCH /api/entries/:id` is completely offline. The legacy foreign key to `foods` and the legacy `foods` table have been dropped.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Entry ID |
| `user_id` | `text` | `NOT NULL DEFAULT (auth.jwt() ->> 'sub')` | Clerk user ID |
| `logged_on` | `date` | `NOT NULL` | Calendar date in user's timezone (`YYYY-MM-DD`) |
| `meal_type` | `text` | `NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack'))` | Meal category |
| `food_id` | `uuid` | `NULL` | ID of reference food item (unconstrained, no cross-DB FK) |
| `food_name` | `text` | `NOT NULL` | Display name of the food item |
| `quantity_g` | `numeric(8,2)` | `NOT NULL CHECK (quantity_g > 0)` | Logged weight in grams |
| `calories` | `numeric(8,2)` | `NOT NULL CHECK (calories >= 0)` | Computed kcal for `quantity_g` |
| `protein_g` | `numeric(8,2)` | `NOT NULL CHECK (protein_g >= 0)` | Computed protein (g) for `quantity_g` |
| `carbs_g` | `numeric(8,2)` | `NOT NULL CHECK (carbs_g >= 0)` | Computed carbs (g) for `quantity_g` |
| `fat_g` | `numeric(8,2)` | `NOT NULL CHECK (fat_g >= 0)` | Computed fat (g) for `quantity_g` |
| `calories_per_100g` | `numeric(8,2)` | `NULL CHECK (calories_per_100g >= 0)` | Snapshotted kcal per 100g |
| `protein_per_100g` | `numeric(8,2)` | `NULL CHECK (protein_per_100g >= 0)` | Snapshotted protein (g) per 100g |
| `carbs_per_100g` | `numeric(8,2)` | `NULL CHECK (carbs_per_100g >= 0)` | Snapshotted carbs (g) per 100g |
| `fat_per_100g` | `numeric(8,2)` | `NULL CHECK (fat_per_100g >= 0)` | Snapshotted fat (g) per 100g |
| `is_estimated` | `boolean` | `NOT NULL DEFAULT false` | `true` if macros came from AI estimation |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

Index: `CREATE INDEX idx_meal_entries_user_date ON meal_entries (user_id, logged_on);`

---

### 4.3 Database B: `user_settings` (User Goals & Timezone)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | `text` | `PRIMARY KEY DEFAULT (auth.jwt() ->> 'sub')` | Clerk user ID |
| `calorie_goal` | `integer` | `NULL CHECK (calorie_goal IS NULL OR calorie_goal > 0)` | Daily calorie target (default `null`) |
| `protein_goal_g` | `integer` | `NULL CHECK (protein_goal_g IS NULL OR protein_goal_g >= 0)` | Daily protein target in g (default `null`) |
| `carbs_goal_g` | `integer` | `NULL CHECK (carbs_goal_g IS NULL OR carbs_goal_g >= 0)` | Daily carbs target in g (default `null`) |
| `fat_goal_g` | `integer` | `NULL CHECK (fat_goal_g IS NULL OR fat_goal_g >= 0)` | Daily fat target in g (default `null`) |
| `timezone` | `text` | `NOT NULL DEFAULT 'UTC'` | IANA timezone string (e.g. `Asia/Kolkata`) |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Last update timestamp |

---

### 4.4 Database B: `ai_usage` (Daily Rate Limit Counter)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | `text` | `NOT NULL` | Clerk user ID (`user_...`), guest cookie (`guest:<uuid>`), or hashed guest IP (`ip:<sha256>`) |
| `usage_date` | `date` | `NOT NULL` | UTC date (`YYYY-MM-DD`) |
| `count` | `integer` | `NOT NULL DEFAULT 0 CHECK (count >= 0)` | Number of `/api/analyze` calls made today |
| **PK** | | `PRIMARY KEY (user_id, usage_date)` | Composite primary key |

---

## 5. Row Level Security (RLS) **[LOCKED]**

**Database A (Food Reference DB):**
- `reference_foods`: RLS enabled with read-only `SELECT` policy for authenticated and anonymous users (`FOR SELECT TO authenticated, anon USING (true)`). No public write operations permitted.

**Database B (User & Log DB):**
- `meal_entries`: `FOR ALL TO authenticated USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id)`
- `user_settings`: `FOR ALL TO authenticated USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id)`
- `ai_usage`: RLS enabled with no direct user access (read/updated exclusively via service role on the server).
- **Mandatory Test (`AGENTS.md` section 4):** Automated test suite verifies User A cannot `SELECT`, `UPDATE`, or `DELETE` User B's rows in `meal_entries` or `user_settings`.

## 6. API Endpoints Contract **[LOCKED]**

All endpoints validate inputs with `zod` and return JSON.

### Error Status Codes **[LOCKED]**
| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | Zod validation failed (invalid body, query param, or ID) |
| `401` | `UNAUTHORIZED` | Missing or invalid Clerk session on protected route |
| `404` | `NOT_FOUND` | Entry not found (or belongs to another user under RLS) |
| `422` | `UNPROCESSABLE_ENTITY` | Gemini could not parse the input text into food items |
| `429` | `RATE_LIMITED` | Daily limit reached (30/day for signed-in users, 3/day per guest cookie, or 5/day per guest IP) |
| `502` | `UPSTREAM_ERROR` | Gemini, USDA, or Supabase upstream request failed |

### 6.1 `POST /api/analyze`
Parses free-text meal description, resolves nutrition via the Hybrid LLM-to-Database Pipeline (Database A pg_trgm + FTS reference search -> predictive ingredient deconstruction -> emergency fallback), and returns analyzed items without saving any meal entry (`FR-2`, `FR-7`).
- **Authentication & Rate Limits:**
  - Authenticated user: verified via Clerk `auth()`, limit is 30 analyses/day tracked in `ai_usage` (`user_id = <clerk_user_id>`).
  - Guest user: unauthenticated callers are identified by `bw_guest_id` HTTP-only cookie (`guest:<uuid>`, limit 3/day) and hashed client IP (`ip:<sha256>`, limit 5/day). If neither cookie nor IP has exceeded limits, request proceeds and `bw_guest_id` cookie is set if missing. When either limit is hit, returns `429 RATE_LIMITED` with message "You've used all 3 free guest analyses for today. Sign in with Google to continue." and code `GUEST_LIMIT_REACHED`.

Supports both JSON and Server-Sent Events (SSE) streaming for sub-500ms perceived latency:
- If client sends `Accept: text/event-stream`, the endpoint streams cards progressively as they resolve:
  - `event: start` with `{ "count": N }`
  - `event: item` with `{ ...ResolvedMealItem }`
  - `event: done` with `{ "items": [ ... ] }`
- Standard `application/json` returns the full payload at once.

- **Request Body:**
  ```json
  { "text": "300 gms oats and 2 katori dal tadka" }
  ```
  (`text`: non-empty trimmed string, max 500 chars)
- **Response `200 OK` (JSON mode):**
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
Saves one or more analyzed food items to the user's daily meal log (`FR-3`), writing both computed totals and `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, and `fat_per_100g` snapshots.

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
        "calories_per_100g": 110,
        "protein_per_100g": 5.5,
        "carbs_per_100g": 14,
        "fat_per_100g": 3.5,
        "is_estimated": false
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
Rescaling is performed **completely offline without cross-database queries**:
- Directly uses the snapshotted `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g` stored on `meal_entries`:
  $$\text{macro} = \text{round}\left(\frac{\text{per\_100g} \times \text{new\_quantity\_g}}{100}, 1\right)$$
- If the entry lacks per-100g columns (legacy rows before migration 0003), falls back to ratio scaling (`oldMacro / oldQuantityG`).

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

## 7. Hybrid LLM-to-Database Nutrition Pipeline **[LOCKED]**

The system enforces a strict division of labor between AI natural language parsing and deterministic database nutrition lookups.

### 7.1 Division of Labor
- **LLM Responsibilities:**
  - Natural language meal parsing and entity segmentation.
  - Conversational portion-to-gram volumetric heuristic conversions (`quantity_g`).
  - Search query normalization (`normalized_query`).
  - Flagging composite dishes (`is_composite`) and providing predictive base ingredients (`candidate_ingredients` with ratio percentages).
- **LLM Exclusions:**
  - The LLM **never** calculates raw macros or calories for identifiable foods.
- **Deterministic Code & Reference DB:**
  - Lab-accurate reference nutrition is fetched from Database A (`reference_foods`).
  - Business logic deterministically computes all macro servings using:
    $$\text{Nutrient Value} = \text{round}\left(\frac{\text{Nutrient per 100g} \times \text{Portion Weight (g)}}{100}, 1\right)$$

### 7.2 Data Types (`lib/ai/provider.ts` & `lib/nutrition/resolve-food.ts`)
```ts
export type PreparationState = "dry" | "raw" | "cooked";

export interface CandidateIngredient {
  ingredient_name: string;
  ratio_percentage: number;
  normalized_query?: string;
}

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
  normalized_query?: string;
  is_composite?: boolean;
  candidate_ingredients?: CandidateIngredient[];
  estimated_macros_per_100g?: MacroPer100g;
  selected_state?: PreparationState;
  variants?: ParsedMealVariant[];
}

export interface ResolvedMealItem {
  food_id: string;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  is_estimated: boolean;
  selected_state?: PreparationState;
  variants?: ResolvedMealVariant[];
}
```

### 7.3 Step-by-Step Execution in `POST /api/analyze`:
1. **Rate Limit Check (`ai_usage`):**
   - Check `ai_usage` for `(userId, current_utc_date)`.
   - If `count >= 30` before increment, reject with `429 RATE_LIMITED`.
2. **Step 1 — Entity Extraction & Portion Conversion (`AIProvider.parseMealText`):**
   - Call Gemini with `thinkingConfig: { thinkingBudget: 0 }`, bounded retry, and structured JSON output.
   - Accepts English, regional/Indian dish names, and Hinglish.
   - **Unit normalization (`normalizeHouseholdUnitToGrams`):**
     - Exact mass/spoon units (`g`, `gm`, `kg`, `oz`, `lb`, `tbsp`, `tsp`) use deterministic server multipliers.
     - Food-dependent household units (`katori`, `cup`, `bowl`, `roti`, `piece`, etc.) trust Gemini's context-aware volumetric gram estimate.
   - **Canonical Search Query & Predictive Decomposition:**
     - Gemini outputs `normalized_query` (e.g. `"dal tadka"` or `"rolled oats raw"`).
     - For composite dishes (`is_composite: true`), Gemini predicts `candidate_ingredients` with percentage breakdown (e.g., Dal Tadka: 45% Toor Dal Cooked, 35% Water, 12% Tomato/Onion, 8% Ghee/Oil).
3. **Step 2 — Quota Increment (`ai_usage`):**
   - Increments user's daily usage count concurrently with food resolution.
4. **Step 3 — Two-Tier Hybrid Nutrition Resolution (`resolveFoodItem`):**
   - **Tier 1 (Direct Reference Match):**
     - Queries Database A using `search_food_reference(query_text, min_similarity=0.35, max_results=5)` utilizing trigram similarity and full-text search.
     - If top match similarity $\ge 0.35$, selects reference food macros and sets `is_estimated = false`.
   - **Tier 2 (Predictive Ingredient Deconstruction):**
     - If direct similarity $< 0.35$ and item has `candidate_ingredients` (or `is_composite = true`), matches each candidate ingredient against Database A.
     - Aggregates weighted macros per 100g: $\sum (\text{ingredient\_macro} \times \text{ratio\_percentage} / 100)$.
     - Sets `is_estimated = false` if ingredients are resolved from reference catalogs.
   - **Tier 3 (Emergency AI Fallback):**
     - If both Tier 1 and Tier 2 fail, falls back to validated AI macro estimate with physical bound and Atwater checks.
     - Flagged explicitly as `is_estimated: true`.
5. **Step 4 — Deterministic Serving Scaling & Streaming:**
   - Multiplies per-100g macros by `quantity_g / 100` with 1-decimal rounding.
   - If `Accept: text/event-stream`, streams each resolved card via SSE for sub-500ms perceived latency. Otherwise, returns full JSON response.




