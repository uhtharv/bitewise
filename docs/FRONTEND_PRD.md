# Bitewise: Frontend PRD

**Status labels:** **LOCKED** (follow exactly) · **PROPOSED** (build as written, keep configurable, report it) · **UNDECIDED** (do not build, ask the owner). See `AGENTS.md` section 2.
**Related:** `docs/PRD.md` (product), `docs/BACKEND_PRD.md` (API contract and data).

## 1. Stack

- Next.js (App Router) **[LOCKED]**
- Tailwind CSS + shadcn/ui **[LOCKED]**. Add components through the shadcn CLI. No other UI library.
- Clerk (`@clerk/nextjs`) for authentication with Google sign-in **[LOCKED]**. Use a custom Bitewise-styled Sign In / Sign Up card and SSO callback built with Clerk's custom-flow hooks (`useSignIn`, `useSignUp`, `HandleSSOCallback`) and `shadcn/ui` components.
- TanStack Query (`@tanstack/react-query`) for client data-fetching, keyed caching, and mutation invalidation **[LOCKED]**.

## 2. Principles **[PROPOSED]**

- Simple: one primary action per screen.
- Honest: an AI estimate is never shown as an exact value.
- Complete: every screen handles loading, empty, error and success states.
- No invented data: the UI shows only what the API returns.

## 3. Screens and routes **[PROPOSED]**

The owner specified a sign-in step, a simple home where you type what you ate, and a daily meal tracker. The route names and the split between screens below are proposed.

### S1. Sign-in & Sign-up (route `/sign-in/[[...sign-in]]`)
- Custom Bitewise-styled authentication card supporting **Sign in** and **Create account** modes with Google OAuth only (`strategy: "oauth_google"`), plus `/sign-in/sso-callback` (`HandleSSOCallback`). Signed-out visitors are redirected here when accessing protected routes (`/today`, `/settings`).
- After sign-in or sign-up, redirect to the sanitized `redirect_url` (defaulting to Home `/`).

### S2. Home (route `/`)
- Publicly accessible to unauthenticated guests for up to 3 analyses per day, and signed-in users for up to 30 analyses per day.
- A multi-line text input with placeholder text such as "What did you eat?". Accepts English as well as regional/Indian dish names and Hinglish.
- An **Analyze** button. Disabled while empty or while loading.
- No upfront counter is shown. If a guest reaches their 3-analysis daily limit and attempts another analysis, an in-context **Sign In Modal** dialog opens prompting them to sign in with Google to unlock 30 analyses per day.
- Results list: one row per item with name, editable quantity in grams (`quantity_g`), calories, protein, carbs, fat, a per-row **Remove** button to drop an unwanted item before saving, an **Estimated** badge (`canvas-soft` `#e8ebe6` pill with `ink` `#0e0f0c` text) when `is_estimated` is true, and an inline segmented toggle of `Button` pills (e.g., `Dry` / `Cooked` or `Raw` / `Cooked`) when the analyzed item has preparation `variants`. Switching variants updates the item's `food_id`, `food_name`, `is_estimated`, and per-100g macros, and switches `quantity_g` to the variant's default `quantity_g` unless the user has manually edited the Grams input (in which case their custom `quantity_g` is preserved and rescaled). Editing `quantity_g` rescales the item's macros proportionally on the client **[LOCKED]**.
- Meal type selector (`breakfast`, `lunch`, `dinner`, `snack`), auto-selected based on local time of day (`05:00–10:59` breakfast, `11:00–15:59` lunch, `16:00–18:59` snack, `19:00–04:59` dinner) **[LOCKED]**.
- Date (`logged_on`) is automatically set to today (`YYYY-MM-DD`) in the user's active timezone with no date picker UI **[LOCKED]**.
- An **Add to today's log** button (disabled if any remaining item has an empty or `<= 0` `quantity_g`, with an inline hint). Nothing is saved until this is pressed **[LOCKED]**.
- For unauthenticated guests clicking **Add to today's log**: an in-context **Sign In Modal** dialog opens explaining that saving meals to the daily log and tracking goals requires an account. The current analyzed items and selected meal type are stored in `sessionStorage` so after completing Google sign-in, the user returns to Home with their analyzed meal restored and ready to add immediately.
- After a successful add, clear the results, clear any temporary draft in `sessionStorage`, invalidate the `['summary', date]` query cache, and confirm with a toast.

### S3. Daily tracker (route `/today`)
- Automatically displays today's date (`YYYY-MM-DD` in the user's active timezone) with no date picker UI **[LOCKED]**.
- Entries grouped by meal type (`breakfast`, `lunch`, `dinner`, `snack`), rendering only the meal type groups that have at least one logged entry for today, each showing macros and the **Estimated** badge when `is_estimated` is true **[LOCKED]**.
- Day totals for calories, protein, carbs and fat. If goals are set (non-null), show `Progress` bars against them (clamped at 100%, showing exact `total / goal` numbers, and styled with `DESIGN.md` warning tokens `#b86700` / `#ffd11a` when `total > goal`); if goals are `null`, show totals only **[LOCKED]**.
- Per entry: edit quantity (`Dialog` + `Input`), and immediate delete on tap (button disabled while request is in flight, followed by a confirmation toast) **[LOCKED]**.

### S4. Settings (route `/settings`) **[LOCKED]**
- Set calorie goal and protein, carbs and fat goals (nullable; default for new users is `null` / unset).
- Timezone `Select` dropdown of standard IANA timezones (plus the browser's detected timezone), pre-selected to the browser's timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) when unset/default `'UTC'`.

## 4. shadcn/ui components **[PROPOSED mapping]**

| Need | Component |
|---|---|
| Meal text input | `Textarea` |
| Buttons | `Button` |
| Result and entry containers | `Card` |
| Meal type & timezone selectors | `Select` |
| Estimated marker | `Badge` |
| Edit quantity & inline gram inputs | `Dialog` + `Input` |
| Goal progress | `Progress` |
| Loading placeholders | `Skeleton` |
| Notifications | the shadcn toast component |

If you need a component that is not on this list, ask first.

## 5. UI states **[PROPOSED]**

Every screen implements all four.

| State | Behavior |
|---|---|
| Loading | Skeletons or a disabled button with a spinner. No layout jump. |
| Empty | Home: input only. Tracker: a short message that nothing is logged for this date. |
| Error | Inline message plus a retry action. Never show raw error text or stack traces. |
| Success | Toast on add, edit, delete and save. |

**Backend error mapping** (suggested copy, adjust only with owner approval):

| Status | Meaning | User message |
|---|---|---|
| 400 | Invalid input | "Please check what you entered." |
| 401 | Not signed in | Redirect to `/sign-in` |
| 422 | AI output could not be parsed | "Couldn't understand that meal. Try rephrasing." |
| 429 | Daily analyze limit reached | "You've hit today's analysis limit. Try again tomorrow." (For guests: "You've used all 3 free guest analyses for today. Sign in with Google to continue.") |
| 502 | Upstream service failed | "Food data is unavailable right now. Try again shortly." |

## 6. Data contract

- Call only the endpoints defined in `docs/BACKEND_PRD.md`, section 6. Use only the fields they return.
- If you need an endpoint or field that does not exist, stop and ask. Do not add it on your own.
- `POST /api/analyze` returns items and saves nothing. `POST /api/entries` saves.
- Show `is_estimated` items with the Estimated badge on every screen where they appear.

## 7. Behavior rules

- Today's date (`logged_on`, `YYYY-MM-DD`) is automatically computed in the user's active timezone (stored `user_settings.timezone`, or browser timezone `Intl.DateTimeFormat().resolvedOptions().timeZone` when unset) with no date picker UI on `/` or `/today`.
- Totals shown on the tracker come from `GET /api/summary`. Do not recompute them differently on the client.
- **[LOCKED]** Changing a quantity on the Home results before adding rescales `calories`, `protein_g`, `carbs_g`, and `fat_g` proportionally on the client (`value_per_100g * quantity_g / 100`) without calling the server again. (Editing a saved entry on `/today` uses `PATCH /api/entries/:id`.)
- **[LOCKED]** Client data-fetching uses TanStack Query (`@tanstack/react-query`) with keyed queries (`['summary', date]`, `['settings']`) and cache invalidation on mutations.

## 8. Responsive and accessibility **[PROPOSED]**

- Mobile-first layout. It must work from a 360 px wide screen up to desktop.
- Every input has a visible label or an accessible name.
- Everything is usable by keyboard. Focus states are visible.
- Meaning is never carried by color alone (the Estimated badge has text).
- Touch targets are at least 44 px.

## 9. Visual design **[LOCKED — `docs/DESIGN.md`]**

Follow [`docs/DESIGN.md`](file:///home/uhtharv/Desktop/bitewise/docs/DESIGN.md):
- Palette: Wise Green primary (`#9fe870`) with `#0e0f0c` (`on-primary`) text, sage-tinted page canvas (`#e8ebe6`), pure white card interiors (`#ffffff`), near-black ink (`#0e0f0c`), and semantic positive/warning/negative tokens.
- Typography: `Inter` via `next/font/google` — weight `900` for display headlines and weights `400` / `600` for body and sub-displays.
- Shapes: `24px` (`rounded-xl`) for cards and buttons, `12px` (`rounded-md`) for inputs, `9999px` (`rounded-full`) for pills/badges.
- Estimated badge: `canvas-soft` (`#e8ebe6`) pill background with `ink` (`#0e0f0c`) text.
- Show "Bitewise" as a plain text wordmark in the sticky top nav bar.
- Dark mode and a theme toggle are not built in v1.

## 10. Not in v1 frontend (do not build)

Charts and trend views, barcode scanner, photo upload, favorites, CSV export, water tracking, onboarding tours.

## 11. Acceptance checklist

- [x] Signed-out users can only see `/sign-in`.
- [x] Typing a meal and pressing Analyze shows items with macros and no data is saved.
- [x] Changing an item's `quantity_g` on Home rescales its macros proportionally before saving; unwanted items can be removed before saving; `quantity_g <= 0` disables saving with an inline hint.
- [x] Estimated items carry a visible Estimated badge (`canvas-soft` `#e8ebe6` pill with `ink` `#0e0f0c` text).
- [x] Add to today's log saves the entry for today's auto-selected date and it appears on `/today` with correct totals.
- [x] Editing a quantity on `/today` updates macros and totals; delete immediately removes the entry with a toast.
- [x] `/settings` allows setting/updating daily calorie and macro goals and selecting an IANA timezone; progress bars appear on `/today` only when goals are set (with warning styling when `total > goal`).
- [x] Each backend error status shows its mapped message.
- [x] Loading, empty and error states exist on every screen.
- [x] Works at 360 px width and with keyboard only.
- [x] No dependency was added beyond what the docs allow.

## 12. Open questions

None. All v1 frontend design questions are resolved.
