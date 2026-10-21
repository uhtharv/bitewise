# Changelog

All notable changes to **Bitewise** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`).

## [2.1.0](https://github.com/uhtharv/bitewise/compare/v2.0.0...v2.1.0) (2026-10-21)


### Added

* **auth:** make authentication optional with public guest trial on Home (FR-1) ([#5](https://github.com/uhtharv/bitewise/issues/5)) ([00f6756](https://github.com/uhtharv/bitewise/commit/00f675606e061107ed0d1c192012cdaf99aae815))

## [2.0.0](https://github.com/uhtharv/bitewise/compare/v1.1.0...v2.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **pipeline:** Segregate static food catalog (Database A) from user logs (Database B). Drop foreign key constraint on meal_entries(food_id) and legacy foods table in Database B; meal_entries now stores per-100g macro snapshots directly for zero cross-database queries. POST /api/analyze supports card-by-card SSE streaming and Tier 1-3 hybrid lookup.

### Added

* **pipeline:** implement hybrid food catalog segregation, offline snapshots, and SSE streaming ([#3](https://github.com/uhtharv/bitewise/issues/3)) ([130ed98](https://github.com/uhtharv/bitewise/commit/130ed986c75a60ed58aba31a3f7e825ad2c916f7))

## [1.1.0](https://github.com/uhtharv/bitewise/compare/v1.0.1...v1.1.0) (2026-10-12)


### Added

* **analyze:** add Dry/Cooked preparation variant switcher and 0-call cache-first meal resolution (FR-2, FR-3) ([d56cef3](https://github.com/uhtharv/bitewise/commit/d56cef3b8db48b775b49da019bb836bf58f35768))


### Fixed

* **nutrition:** enforce physical/Atwater macro validation, multi-model fallback, and lossless entry rescaling (FR-2, FR-5, FR-7) ([8c6ecf2](https://github.com/uhtharv/bitewise/commit/8c6ecf2aef166b84c83f835e653986eaf4cf29c6))

## [1.0.1] - 2026-10-11

### Fixed
- **Clerk Production Script Loading (`FR-1`):** Disabled Clerk's build-time `.vercel.app` auto-proxy override (`CLERK_DISABLE_AUTO_PROXY="true"` in `next.config.ts` and `app/layout.tsx`) so production loads Clerk bundles directly from `https://clerk.bite-wise.app`, and updated `middleware.ts` (`config.matcher`, `shouldEnableFrontendApiProxy`, `isClerkProxyPath`) to match and proxy `/__clerk` requests instead of returning `404 Not Found`.
- **GitHub Release Workflow:** Replaced regex matching with literal `index($0, "## [" ver "]") == 1` in `.github/workflows/release.yml` when extracting versioned release notes from `CHANGELOG.md`.

## [1.0.0] - 2026-10-11


### Added
- **Google Authentication (`FR-1`):** Custom Bitewise-styled Sign In / Sign Up card and SSO callback under `/sign-in/[[...sign-in]]` powered by Clerk Google OAuth.
- **Natural-Language Meal Analysis (`FR-2`):** `/api/analyze` endpoint and Home (`/`) meal analyzer supporting English, regional/Indian dish names, and Hinglish, normalizing household quantities into grams (`quantity_g`).
- **3-Stage Grounded Nutrition Pipeline (`FR-2`, `FR-7`):** Shared Postgres `foods` cache -> USDA FoodData Central API lookup -> single-pass Gemini fallback estimate transparently flagged with `is_estimated = true` and `Estimated` UI badges.
- **Pre-Save Meal Confirmation (`FR-3`):** Inline gram (`quantity_g`) editing with instant proportional macro rescaling, per-item removal, and time-of-day meal category default (`breakfast`, `lunch`, `dinner`, `snack`).
- **Daily Meal Tracker (`FR-4`, `FR-5`):** `/today` route displaying daily calorie and macro totals, goal progress bars with over-goal warning states, meal-grouped entries, inline quantity editing (`PATCH /api/entries/:id`), and entry deletion (`DELETE /api/entries/:id`).
- **Goals & Timezone Settings (`FR-6`):** `/settings` route (`GET` / `PUT /api/settings`) with nullable daily calorie/macro targets and IANA timezone selection (auto-detected from browser when unset).
- **Database Schema & RLS Isolation:** Supabase PostgreSQL schema (`0001_initial_schema.sql`) with Row Level Security policies on `foods`, `meal_entries`, `user_settings`, and `ai_usage`, verified by automated RLS isolation tests.
