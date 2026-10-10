# Bitewise: Product PRD

**Audience for this doc:** coding agents and the owner.
**Status labels:** **LOCKED** (owner decided, follow exactly) · **PROPOSED** (drafted, not yet confirmed: build as written, keep it configurable, report it) · **UNDECIDED** (do not build, ask the owner). See `AGENTS.md` section 2.

## 1. Summary

Bitewise is a small web app for tracking calories and macros. A signed-in user types what they ate in plain language, the app works out calories and macros automatically, and the user can add the result to their daily meal tracker. **[LOCKED]**

## 2. Users and context

- Users are the owner, friends and family. **[LOCKED]**
- Non-commercial side project. **[LOCKED]**
- Expected scale is fewer than 50 users. **[PROPOSED]**
- Anyone with a Google account may sign up; usage is capped by the per-user daily AI analysis limit (30/day). **[LOCKED]**

## 3. Goals

- G1: Logging a meal takes one typed sentence and one tap to confirm. **[PROPOSED]**
- G2: Numbers come from real nutrition data where possible. The AI estimates only as a fallback, and estimates are labeled. **[PROPOSED]**
- G3: Each user can only see their own data. **[PROPOSED]**
- G4: Everything runs on free tiers. **[LOCKED: owner does not want to pay for the AI model; PROPOSED for the other services]**

## 4. Not in v1 (do not build)

Micronutrients, recipes, social features, payments, native mobile apps, medical-grade accuracy claims. **[PROPOSED]**
If you think one of these is needed, ask the owner.

## 5. Core user flow **[LOCKED]**

1. User signs in with Google.
2. User lands on a simple home screen and types what they ate.
3. The app automatically gets the macros.
4. The user is offered the option to add it to their daily meal tracker.

## 6. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-1 | Sign in and sign up with Google through Clerk. Unauthenticated users cannot use the app. | LOCKED |
| FR-2 | User enters a free-text description of a meal. The system returns each food item with quantity, calories, protein, carbs and fat. Nothing is saved at this step. | LOCKED (flow) / PROPOSED (nothing saved until confirmed) |
| FR-3 | User can add the analyzed result to their daily meal tracker for today's auto-selected date (in the user's timezone) and a chosen meal type. | LOCKED |
| FR-4 | User can view today's logged entries with day totals for calories and macros. | LOCKED (daily tracker) / PROPOSED (exact layout) |
| FR-5 | User can edit an entry's quantity and delete an entry. Macros rescale with quantity. | LOCKED |
| FR-6 | User can set a daily calorie goal and macro goals, and see totals against them. Default goals for a new user are `null` (unset). | LOCKED |
| FR-7 | Any value that came from an AI estimate is flagged as estimated everywhere it is shown. | LOCKED |

Technical detail for each requirement lives in `docs/BACKEND_PRD.md` and `docs/FRONTEND_PRD.md`.

## 7. Later phases (do not build until the owner asks) **[PROPOSED]**

Saved and favorite meals, per-day range summaries, CSV export, barcode lookup, photo-based logging, water tracking, account data deletion.

## 8. Data and AI rules **[LOCKED]**

- Order of truth for macros: cached food (`foods` table), then USDA FoodData Central, then a Gemini estimate marked as estimated (`is_estimated = true`). Open Food Facts is not used in v1.
- Every resolved food (including AI estimates, preserving `is_estimated = true`) is cached in `foods` so each food is looked up once. No custom CSV seed is required for v1.
- Gemini is used to parse text into items (normalizing household units into grams `quantity_g`) and to estimate macros when no USDA data exists. It must not be the default source of numbers when real data exists.
- Full pipeline: `docs/BACKEND_PRD.md`, section 7.

## 9. Constraints

- Free tiers only: Vercel Hobby, Supabase, Clerk, Gemini API free tier, and USDA FoodData Central. **[LOCKED]**
- Gemini free-tier limits and terms change often. Before relying on any number, check Google's current rate-limits page. Free-tier inputs may be used by Google to improve its products, so users should be told meal text is sent to a third-party AI. **[PROPOSED]**

## 10. Success criteria **[PROPOSED]**

A new user can sign in with Google, analyze a meal, add it, edit its quantity and see correct day totals, and no user can read or change another user's data.

## 11. Decision log (LOCKED, owner-stated)

| Date | Decision |
|---|---|
| 2026-10-10 | Product name is Bitewise |
| 2026-10-10 | Non-commercial; users are owner, friends and family |
| 2026-10-10 | Stack: Next.js, Clerk (Google sign-in), Supabase |
| 2026-10-10 | AI provider: Gemini API free tier |
| 2026-10-10 | Styling: Tailwind CSS + shadcn/ui |
| 2026-10-10 | Sign-up: Open to any Google account via Clerk; usage capped by daily AI limit |
| 2026-10-10 | Gemini model: GEMINI_MODEL=gemini-3.5-flash (read from env var) |
| 2026-10-10 | Daily AI limit: 30 analyses per user per day (tracked in ai_usage) |
| 2026-10-10 | Units: All quantities normalized to grams (quantity_g); Gemini converts household units using prompt reference weights |
| 2026-10-10 | Nutrition pipeline: foods cache -> USDA FoodData Central -> Gemini estimate (is_estimated=true); no Open Food Facts or CSV seed in v1 |
| 2026-10-10 | Goals & Settings: /settings in v1 with null default goals and browser-detected default timezone |
| 2026-10-10 | Hosting: Vercel Hobby (free tier) |
| 2026-10-10 | Language: English UI; meal input accepts regional/Indian dish names and Hinglish |
| 2026-10-10 | Home quantity edit: Inline quantity_g editing before saving with proportional client-side macro rescaling |
| 2026-10-10 | Client data fetching & approved packages: @tanstack/react-query, @clerk/nextjs, @supabase/supabase-js, @google/genai, zod, vitest |
| 2026-10-10 | Visual identity: Defined in docs/DESIGN.md; typography uses Inter (weight 900 display, 400/600 body); Estimated badge uses canvas-soft (#e8ebe6) pill with ink (#0e0f0c) text |
| 2026-10-10 | Date handling: Today's date (YYYY-MM-DD in the user's active timezone) is auto-selected on both Home (/) and Daily Tracker (/today) with no date picker UI |
| 2026-10-10 | Home pre-save UX: meal_type defaults by local time of day; per-row Remove button to drop unwanted analyzed items; "Add to today's log" disabled if any item has quantity_g <= 0 |
| 2026-10-10 | Daily tracker (/today) UX: Render only non-empty meal groups; clamp Progress bars at 100% and style over-goal bars with DESIGN.md warning tokens (#b86700 / #ffd11a); immediate per-entry Delete with toast |
| 2026-10-10 | Settings (/settings) & testing: Timezone uses a Select of standard IANA timezones (pre-selected to browser timezone when unset); frontend unit tests run in Vitest Node + react-dom/server with zero extra test dependencies |
| 2026-10-10 | Auth UI: Custom Bitewise-styled Sign In / Sign Up card and SSO callback under /sign-in/[[...sign-in]] using Clerk custom-flow hooks (useSignIn, useSignUp, HandleSSOCallback) with Google OAuth |
| 2026-10-11 | Analyze performance & resilience: Gemini calls use thinkingBudget: 0 and single-pass fallback macro estimation in parseMealText(); USDA lookup forces IPv4 with a 3.5s timeout and falls back to Gemini (is_estimated=true) on timeout/unreachable; ai_usage write and item resolution run in parallel via Promise.all with normalized_name deduplication |
| 2026-10-11 | Repository, license & gitignore: Public GitHub repository (uhtharv/bitewise) licensed under GNU AGPLv3 (AGPL-3.0); all .env* files (including .env.example), .clerk/, supabase/.branches, and supabase/.temp are git-ignored |
| 2026-10-11 | Versioning & releases: Semantic Versioning 2.0.0 starting at v1.0.0 tracked in package.json, CHANGELOG.md, and Git tags via npm version scripts (release:patch/minor/major) and automated GitHub Releases (.github/workflows/release.yml); no version displayed in UI |

New entries are added only after the owner confirms them.

## 12. Open questions (UNDECIDED: ask before building anything that depends on them)

None. All v1 product and frontend design questions are resolved.
