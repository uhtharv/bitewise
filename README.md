# Bitewise

Bitewise is a fast, minimal calorie and macro tracker web app. Type what you ate in plain language (English, regional/Indian dish names, or Hinglish), get grounded calorie and macronutrient breakdowns automatically, adjust gram quantities or toggle preparation states (`Dry`/`Raw` vs. `Cooked`) inline, and log meals to your daily tracker.

---

## Features

- **Natural-Language Meal Analysis with Real-Time SSE Streaming:** Describe your meal in a single sentence (e.g., `"2 chapati, 1 bowl dal tadka and 150g dahi"`). Bitewise streams analyzed food cards progressively to the UI via Server-Sent Events (SSE) while normalizing household measurements (`bowl`, `cup`, `katori`, `roti`, `tbsp`, `piece`) into grams (`quantity_g`).
- **Grounded 3-Tier Hybrid LLM-to-Database Pipeline:**
  1. **Tier 1 — Curated Food Reference DB (Database A):** High-speed read-heavy static catalog with PostgreSQL trigram (`pg_trgm`) and full-text search indexing verified items from USDA FoodData Central, ICMR-NIN (IFCT 2017), and Open Food Facts.
  2. **Tier 2 — Predictive Ingredient Deconstruction:** Deconstructs complex regional and composite dishes into underlying reference staples with deterministic macro aggregation.
  3. **Tier 3 — Emergency AI Fallback:** Single-pass Gemini macro estimation, strictly validated against physical bounds (`P + C + F <= 105g`, `calories <= 900 kcal`) and Atwater energy, visibly badged as **`Estimated`** (`is_estimated = true`).
- **Dual-Database Architecture & Zero Cross-DB Joins:** Strict segregation between read-only Food Catalog (Database A) and transactional User Logs (Database B). Historical meal logs snapshot computed macros and per-100g reference values, allowing completely offline, lossless quantity rescaling with zero cross-database queries.
- **Preparation State Variant Switcher:** When a food has distinct `dry`/`raw` vs. `cooked` forms and the state is unspecified in the prompt (e.g., `"100g oats"` or `"150g chicken breast"`), Bitewise resolves both variants and shows an inline `Dry` / `Cooked` (or `Raw` / `Cooked`) pill switcher on Home (`/`) that updates macros and default `quantity_g` while preserving custom user-edited weights.
- **Interactive Pre-Save Review:** Tweak gram quantities (`quantity_g`) with instant client-side macro rescaling, remove individual items, and choose the meal category (`breakfast`, `lunch`, `dinner`, `snack`) before logging.
- **Daily Tracker (`/today`):** Track daily calorie, protein, carb, and fat totals against your personal goals with meal-grouped entries, lossless per-100g quantity editing, and one-tap deletion.
- **Goals & Timezone (`/settings`):** Set custom daily calorie and macro targets (or leave them unset) and configure your local IANA timezone.
- **Strict Data Isolation & Free-Tier Guardrails:** Powered by Clerk Google OAuth and Supabase Row Level Security (RLS) so each user can only access their own logs and settings, plus a built-in daily AI analysis cap (`30` analyses/user/day).

---

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router, TypeScript strict mode)
- **Styling & UI:** [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **Authentication:** [Clerk](https://clerk.com/) (`@clerk/nextjs`) with Google OAuth
- **Database:** [Supabase](https://supabase.com/) (PostgreSQL + Row Level Security + pg_trgm)
- **AI & Nutrition Data:** [Google Gemini API](https://ai.google.dev/) (`@google/genai`) + Curated IFCT/USDA/OpenFoodFacts Reference Catalog
- **State & Validation:** [TanStack Query v5](https://tanstack.com/query/latest) + [Zod v4](https://zod.dev/)
- **Testing:** [Vitest](https://vitest.dev/)

---

## Getting Started (Self-Hosting & Local Development)

Everything in Bitewise is designed to run on free tiers (Vercel Hobby, Supabase Free, Clerk Free, and Google AI Studio Free Tier).

### 1. Clone and install dependencies

```bash
git clone https://github.com/uhtharv/bitewise.git
cd bitewise
npm install
```

### 2. Set up the services

1. **Supabase (Database B - User Logs & RLS):**
   - Create a project on [Supabase](https://supabase.com/).
   - Open the **SQL Editor** in your Supabase dashboard and run [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) (and [`supabase/migrations/0003_drop_foods_fk_add_per_100g_snapshots.sql`](supabase/migrations/0003_drop_foods_fk_add_per_100g_snapshots.sql) if upgrading an existing deployment) to set up `meal_entries`, `user_settings`, and `ai_usage` tables with Row Level Security.
2. **Supabase (Database A - Food Reference DB):**
   - Optionally create a second Supabase project for the reference catalog (or run it on the same project). Run [`supabase/reference_migrations/0001_reference_schema.sql`](supabase/reference_migrations/0001_reference_schema.sql) and ingest datasets using `npx tsx scripts/etl/ingest.ts`.
3. **Clerk (Google Sign-In):**
   - Create an application on [Clerk](https://clerk.com/) and enable **Google** as a social connection.
   - Connect Clerk to Supabase using [Clerk's native Supabase Third-Party Auth integration](https://supabase.com/docs/guides/auth/third-party/clerk) so Clerk session tokens authenticate directly against Supabase RLS (`auth.jwt() ->> 'sub'`).
4. **Google Gemini API Key:**
   - Generate a free-tier API key in [Google AI Studio](https://aistudio.google.com/).

### 3. Configure environment variables

Create a `.env.local` file in the root directory:

```dotenv
# Google AI Studio (Server-only; supports comma-separated fallback models)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.1-flash-lite

# Food Reference DB (Database A; optional, falls back to Database B if unset)
FOOD_DATABASE_URL=https://your-reference-db.supabase.co
FOOD_DATABASE_ANON_KEY=your_reference_db_anon_key

# Supabase (Database B - User DB; service role is server-only)
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
NEXT_PUBLIC_SUPABASE_URL=https://your-user-db.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_user_db_anon_key

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser, sign in with Google, and start logging meals.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js development server on `http://localhost:3000` |
| `npm run build` | Build the production Next.js application |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint across the repository |
| `npm run typecheck` | Run TypeScript strict type checking (`tsc --noEmit`) |
| `npm test` | Run the Vitest unit and integration test suite |

---

## Versioning & Automated Releases (`release-please`)

Bitewise follows [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`) and [Conventional Commits](https://www.conventionalcommits.org/), automated via [`googleapis/release-please-action`](.github/workflows/release.yml):

1. Commit and push changes to `main` using Conventional Commit prefixes:
   - `fix: ...` → Bumps `PATCH` (`1.1.0` → `1.1.1`)
   - `feat: ...` → Bumps `MINOR` (`1.0.1` → `1.1.0`)
   - `feat!: ...` or `BREAKING CHANGE:` → Bumps `MAJOR` (`1.1.0` → `2.0.0`)
2. On every push to `main`, `release-please` automatically opens or updates a **Release PR** that bumps `package.json`, `.release-please-manifest.json`, and [`CHANGELOG.md`](CHANGELOG.md).
3. Merging the Release PR automatically tags the release (`vX.Y.Z`) and publishes the official GitHub Release.

---

## Project Structure & Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — Version history managed by `release-please`
- [`docs/PRD.md`](docs/PRD.md) — Product requirements, user flow, constraints, and decision log
- [`docs/BACKEND_PRD.md`](docs/BACKEND_PRD.md) — Database schema, RLS policies, API contracts, and nutrition pipeline
- [`docs/FRONTEND_PRD.md`](docs/FRONTEND_PRD.md) — Route structure, screen specifications, and UI states
- [`docs/DESIGN.md`](docs/DESIGN.md) — Visual identity, color tokens, and typography rules
- [`supabase/migrations/`](supabase/migrations) — PostgreSQL schema migrations and RLS policies

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see the [`LICENSE`](LICENSE) file for details.
