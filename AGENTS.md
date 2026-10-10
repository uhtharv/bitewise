# AGENTS.md: Bitewise

You are helping build **Bitewise**, a small calorie and macro tracker web app.
Read this whole file before every task, then read the docs the task touches.

## 1. Source of truth (priority order)

1. This file
2. `docs/PRD.md`: what we are building and why
3. `docs/BACKEND_PRD.md`: data model, API, AI pipeline
4. `docs/FRONTEND_PRD.md`: screens, components, UI states

If two docs conflict, the higher one wins and you must tell the owner about the conflict.
If a chat instruction conflicts with a doc, ask the owner which one wins. Do not pick silently.

## 2. Zero-assumption protocol

If a requirement, name, value, behavior or decision is not written in these docs or stated by the owner in this session, it is **UNKNOWN**. Do not fill it in.

When you hit something unknown:
1. Stop work on that item.
2. Ask the owner in chat: one specific question, 2 or 3 concrete options, and say which you would pick and why.
3. Keep working only on tasks that are not blocked.
4. Once the owner answers, propose the exact line to add to the decision log in `docs/PRD.md`. Record it only after the owner confirms.

Never write "I'll use a sensible default". Never invent.

Status labels used in all docs:

| Label | Meaning | What you do |
|---|---|---|
| **LOCKED** | Owner decided | Follow exactly |
| **PROPOSED** | Drafted by Claude, not yet confirmed by owner | Implement as written, keep it configurable and easy to change, and list it under "Proposed items used" in your report |
| **UNDECIDED** | No decision exists | Do not build. Ask the owner |

## 3. Locked decisions

| Topic | Decision |
|---|---|
| Product name | Bitewise |
| Nature | Non-commercial side project. Users are the owner, friends and family |
| Framework | Next.js |
| Auth | Clerk, with Google sign-in |
| Database | Supabase (Postgres) |
| AI provider | Gemini API, free tier only |
| Styling | Tailwind CSS + shadcn/ui |
| Core flow | Sign in with Google, then a simple home where you type what you ate, macros are fetched automatically, then you can choose to add it to your daily meal tracker |

## 4. Hard rules (never do these)

- Do not add a dependency that is not already in `package.json` or named in the docs. If you need one, ask with: name, purpose, and the alternative of not using it.
- Do not upgrade or downgrade package versions.
- Do not invent endpoints, tables, columns, env vars, components or routes that are not in the docs. If you need one, ask.
- Do not hardcode a Gemini model ID. Read it from `GEMINI_MODEL`. If it is unset, ask the owner for the value.
- Do not state how a library API works from memory as fact. Check the installed version's types or official docs. If you cannot verify, say "unverified".
- Do not use any paid service or anything that requires billing.
- Never commit secrets. Keep all `.env*` files (including `.env.local` and `.env.example`) git-ignored and maintain `.env.example` locally with names only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` or `USDA_API_KEY` to client code (no `NEXT_PUBLIC_` prefix, never imported in client components).
- Never disable Row Level Security. Every new user-data table needs RLS plus a test proving one user cannot access another's rows.
- Never present AI-estimated values as exact. Anything with `is_estimated = true` must be visibly marked as an estimate in the UI.
- No fake or mock data in real code paths. Mocks live in tests only and are named as mocks.
- No scope creep. Do not build anything listed as not in v1 or later phase.
- No destructive actions (dropping tables, deleting files, force-pushing) without explicit approval.

## 5. How to work

- Work on one task at a time.
- Before writing code, post a short plan: which files you will touch and which requirement IDs (for example `FR-3`) it satisfies.
- Run lint, typecheck and tests before saying a task is done. Paste the results. If you could not run something, say so. Never claim something works without running it.
- If you find a mistake in a doc or in your own earlier work, say so plainly.

**End-of-task report format**
1. Done
2. Not done
3. Questions for owner (anything UNKNOWN you hit)
4. Proposed items used
5. Files changed

## 6. Conventions

- TypeScript in strict mode. No `any` without a one-line comment explaining why.
- Validate all API input with `zod`.
- Server-only logic stays in route handlers and server code.
- User data goes through the user-scoped Supabase client so RLS applies. The service-role client is only for the shared `foods` cache and `ai_usage`.
- The AI provider lives behind an interface at `lib/ai/provider.ts` so it can be swapped.
- Env var names we define: `GEMINI_API_KEY`, `GEMINI_MODEL`, `USDA_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. For Clerk and Supabase public keys, use the names from their current official setup docs and record them in `.env.example`. Do not guess them.
- UI uses shadcn/ui components (added through its CLI) and Tailwind utility classes. No other UI library.

## 7. Definition of done

A task is done only when all of these are true:
- It meets the cited requirement IDs exactly, with nothing extra.
- Lint, typecheck and tests pass, with output shown.
- No secret is committed and local `.env.example` is current.
- Loading, empty and error states exist for anything user-facing.
- The end-of-task report is written.

## 8. Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (identity mapping). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.