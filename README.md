# Bitewise

Bitewise is a fast, minimal calorie and macro tracker web app. Type what you ate in plain language (English, regional/Indian dish names, or Hinglish), get grounded calorie and macronutrient breakdowns automatically, adjust gram quantities inline, and log meals to your daily tracker.

---

## Features

- **Natural-Language Meal Analysis:** Describe your meal in a single sentence (e.g., `"2 chapati, 1 bowl dal tadka and 150g dahi"`). Bitewise parses each item and normalizes household measurements (`bowl`, `cup`, `roti`, `tbsp`, `piece`) into grams (`quantity_g`).
- **Grounded 3-Stage Nutrition Pipeline:**
  1. **Shared Postgres Cache (`foods`):** Instant lookup for previously resolved foods.
  2. **USDA FoodData Central:** Official per-100g nutrition data when not yet cached.
  3. **Gemini Fallback Estimate:** Used only when no USDA match exists, and always transparently flagged with an **`Estimated`** badge across the UI.
- **Interactive Pre-Save Review:** Tweak gram quantities (`quantity_g`) with instant client-side macro rescaling, remove individual items, and choose the meal category (`breakfast`, `lunch`, `dinner`, `snack`) before logging.
- **Daily Tracker (`/today`):** Track daily calorie, protein, carb, and fat totals against your personal goals with meal-grouped entries, inline quantity editing, and one-tap deletion.
- **Goals & Timezone (`/settings`):** Set custom daily calorie and macro targets (or leave them unset) and configure your local IANA timezone.
- **Strict Data Isolation & Free-Tier Guardrails:** Powered by Clerk Google OAuth and Supabase Row Level Security (RLS) so each user can only access their own logs and settings, plus a built-in daily AI analysis cap (`30` analyses/user/day).

---

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router, TypeScript strict mode)
- **Styling & UI:** [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **Authentication:** [Clerk](https://clerk.com/) (`@clerk/nextjs`) with Google OAuth
- **Database:** [Supabase](https://supabase.com/) (PostgreSQL + Row Level Security)
- **AI & Nutrition Data:** [Google Gemini API](https://ai.google.dev/) (`@google/genai`) + [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide.html)
- **State & Validation:** [TanStack Query v5](https://tanstack.com/query/latest) + [Zod v4](https://zod.dev/)
- **Testing:** [Vitest](https://vitest.dev/)

---

## Getting Started (Self-Hosting & Local Development)

Everything in Bitewise is designed to run on free tiers (Vercel Hobby, Supabase Free, Clerk Free, Google AI Studio Free Tier, and USDA FoodData Central).

### 1. Clone and install dependencies

```bash
git clone https://github.com/uhtharv/bitewise.git
cd bitewise
npm install
```

### 2. Set up the services

1. **Supabase (Database & RLS):**
   - Create a new project on [Supabase](https://supabase.com/).
   - Open the **SQL Editor** in your Supabase dashboard and run the migration file at [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) to create the `foods`, `meal_entries`, `user_settings`, and `ai_usage` tables along with their Row Level Security policies.
2. **Clerk (Google Sign-In):**
   - Create an application on [Clerk](https://clerk.com/) and enable **Google** as a social connection.
   - Connect Clerk to Supabase using [Clerk's native Supabase Third-Party Auth integration](https://supabase.com/docs/guides/auth/third-party/clerk) so Clerk session tokens authenticate directly against Supabase RLS (`auth.jwt() ->> 'sub'`).
3. **Google Gemini API Key:**
   - Generate a free-tier API key in [Google AI Studio](https://aistudio.google.com/).
4. **USDA FoodData Central API Key:**
   - Sign up for a free API key at [USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup.html).

### 3. Configure environment variables

Create a `.env.local` file in the root directory:

```dotenv
# Google AI Studio (Server-only)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash

# USDA FoodData Central (Server-only)
USDA_API_KEY=your_usda_api_key

# Supabase (Service role is server-only; never expose to the client)
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

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

## Project Structure & Documentation

- [`docs/PRD.md`](docs/PRD.md) — Product requirements, user flow, constraints, and decision log
- [`docs/BACKEND_PRD.md`](docs/BACKEND_PRD.md) — Database schema, RLS policies, API contracts, and 3-stage nutrition pipeline
- [`docs/FRONTEND_PRD.md`](docs/FRONTEND_PRD.md) — Route structure, screen specifications, and UI states
- [`docs/DESIGN.md`](docs/DESIGN.md) — Visual identity, color tokens, and typography rules
- [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) — PostgreSQL schema and RLS policies

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see the [`LICENSE`](LICENSE) file for details.
