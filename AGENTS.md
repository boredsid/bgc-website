# BGC Website

Board Game Company — Bangalore's board gaming community. Public site + admin tool + API worker.

## Stack

- **Astro 5** (static, with `@astrojs/sitemap`) + **React 19** islands
- **Tailwind CSS 4** (CSS-based config in `src/styles/global.css`)
- **Supabase** Postgres + RLS — project ref `yhgtwqdsnrslcgdvmunz`
- **Cloudflare Pages** (site, auto-deploys on push to `main`)
- **Cloudflare Workers** (API at `api.boardgamecompany.in`, deployed manually)
- **Cloudflare Access** gates admin tool + admin API (JWT verified in worker)

## Three deployables

| Path | What | Deploy |
|---|---|---|
| `./` | Public Astro site → `boardgamecompany.in` | Push to GitHub |
| `./admin/` | Vite + React + shadcn admin tool → `admin.boardgamecompany.in` | Push to GitHub (Pages builds it) |
| `./worker/` | Cloudflare Worker API → `api.boardgamecompany.in` | `cd worker && npx wrangler deploy` |

Browser reads public `games` / `events` directly from Supabase via anon key + RLS. Anything sensitive (lookup, register, credits, admin) goes through the worker which holds the service-role key.

## Layout

- `src/pages/` — public site routes (Astro)
- `src/components/` — public React islands + Astro partials
- `src/lib/` — `supabase.ts`, `types.ts`, `guild-tiers.ts`, `source.ts` (UTM/source attribution via sessionStorage)
- `worker/src/` — root handlers + `worker/src/admin/` (admin endpoints) + `*.test.ts` (Vitest)
- `admin/src/` — admin SPA, separate package, shadcn-based
- `supabase/migrations/` — `001`–`017` (initial schema, guild_path rename, source attribution, price_includes, plus_ones, cancelled status, user_credits, leads, llm_notes, user_promos, guild_path_exclusive, guest admins, waitlist fields, Demon's Draft submissions, corporate events)
  - **New-table grants (from migration `014`+):** Supabase stops auto-exposing `public` tables to the Data API for this project on **2026-10-30**. After that, any new `public` table is invisible to PostgREST until granted — this hits the **worker (`service_role`) too**, not just public `anon` reads. So every new-table migration must include: `grant all on public.<table> to authenticated, service_role;` plus `grant select on public.<table> to anon;` only if the browser reads it directly (pair with RLS). Existing tables keep their grants; no backfill needed.
- `docs/superpowers/specs/` — design specs + implementation plans

## Supabase tables

| Table | Public read | Notes |
|---|---|---|
| `games` | yes | Library, ~130 games. `owned_by` / `currently_with` are internal — never expose to public site |
| `events` | yes (published only via RLS) | `custom_questions` JSONB drives dynamic registration fields. `guild_path_exclusive` gates public registration to active Guild Path members (worker-enforced) |
| `users` | no | All registrants ever |
| `guild_path_members` | no | Membership tiers + expiry (renamed from `guild_members` in migration 002) |
| `registrations` | no | Spots are summed by `seats` on confirmed rows, not row counts |
| `user_credits` | no | Credit ledger; auto-applied on registration/purchase, idempotent |
| `leads` | no | Partial registration capture (phone+event); auto-converted on registration; admin-managed via `/api/admin/leads*` |
| `user_promos` | no | One-time free-registration grants; apply before guild discounts and credits |
| `event_guest_admins` | no | Event-scoped, time-bound access for collaboration partners |
| `corporate_events` | yes (published only via RLS) | Display-only B2B showcase records; no registration/capacity logic |
| `dd_submissions` | no | Demon's Draft contest submissions |

## Worker endpoints

**Public:** `POST /api/lookup-phone`, `POST /api/register`, `GET /api/event-spots/:id`, `POST /api/guild-purchase`, `POST /api/lead`, `POST /api/waitlist`, `POST /api/guild-status`, `GET /api/event-photos*`, `POST /api/dd-submit`

**Admin** (gated by Cloudflare Access JWT + `ADMIN_EMAILS` allowlist, all under `/api/admin/`): `whoami`, `summary`, `search`, `log`, `lookup-phone`, `cancel-registration`, `events` (CRUD), `games` (CRUD + `export`, `owners-summary`), `registrations` (list/get/update + `manual` + `export`), `guild-members` (CRUD + `export`), `users` (list/get/update + credit adjustment), `leads` (list + patch junk + `export`), `promos` (CRUD), `corporate-events` (CRUD + logo upload).

**MCP:** `POST /mcp` is a public, unauthenticated Streamable HTTP server in `worker/src/mcp/`. It deliberately has no cancellation tools. Write tools must call the existing request handlers rather than reimplement pricing/credits. If a post-success amount lookup fails, return an unknown amount with guidance instead of implying nothing is due or retrying the write. Duplicate event registrations require explicit user confirmation through `confirm_additional: true`.

Routing is a flat `if/else` chain in `worker/src/index.ts` — add new endpoints there.

## Environment

**Astro** (`.env.local` for dev, Cloudflare Pages env vars for prod):
- `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_WORKER_URL` (e.g. `https://api.boardgamecompany.in`)
- `PUBLIC_UPI_ID` (read by `UpiPaymentBlock.tsx`)

**Worker** (`worker/wrangler.toml` `[vars]` for non-secret, `wrangler secret put` for secret):
- vars: `SUPABASE_URL`, `UPI_ID`, `BGC_SITE_URL`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ENVIRONMENT`
- secrets: `SUPABASE_SERVICE_KEY`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`, `ADMIN_EMAILS`

Email is sent via a Google Apps Script webhook (`APPS_SCRIPT_URL`) signed with `APPS_SCRIPT_SECRET`.

## Development

```bash
npm run dev                       # Astro on :4321
cd worker && npm run dev          # Worker on :8787
cd worker && npm test             # Vitest (cancel, credits, access-auth)
cd admin && npm run dev           # Admin SPA
cd admin && npm test
```

## Deployment

- **Site / admin:** push to `main` → Cloudflare Pages auto-deploys (separate Pages projects). Pages runs the build itself; `admin/dist` is gitignored and never committed. `cd admin && npm run build` is only a local pre-flight check that it compiles.
- **Worker:** `cd worker && npx wrangler deploy` (manual — does NOT auto-deploy on push)
- After changing Pages env vars, retry/redeploy from the dashboard for them to take effect

## Design

Orange Energy palette — primary `#F47B20`, bg `#FFF8F0`, secondary `#1A1A1A`, accent `#4A9B8E`, highlight `#FFD166`. Fonts: Space Grotesk (headers), Inter (body). Logo at `public/bgc-logo.png`.

Admin tool uses shadcn defaults and is operated by non-coders, often on mobile. Prefer structured forms, plain-English validation with suggested fixes, smart defaults, autofill, phone-first lookups, and single-tap actions. Avoid raw JSON, technical IDs/slugs in labels, and unnecessary typing; confirm destructive actions with their concrete consequences.

## Gotchas

- Astro build runs without `.env.local` access for some imports — `src/lib/supabase.ts` has fallback values so `astro build` doesn't crash; React islands use the real values at runtime.
- Supabase URLs use the dashboard project ref (`https://<project-ref>.supabase.co`); never guess a URL from the project name. A wrong URL can fail without a useful error.
- `games.owned_by` and `games.currently_with` are internal — never surface in public components.
- Event spot capacity = sum of `seats` across confirmed registrations, not row count. Per-option capacity uses the same weighting.
- Differential option pricing lives in `worker/src/pricing.ts`: if any selected radio/select option has a defined `price` (including `0`), the sum of selected priced options replaces the event base price per seat. Keep its hand-copied mirror in `src/components/RegistrationForm.tsx` synchronized with the worker helper.
- `user_credits` is applied automatically on registration / guild purchase. Cancellation credits the user back; the credit logic is idempotent (see `worker/src/credits.ts` + tests).
- Admin API is double-gated: Cloudflare Access JWT (`verifyAccessJwt` in `worker/src/access-auth.ts`) **and** email allowlist (`ADMIN_EMAILS`). Adding an admin = updating the secret + the Cloudflare Access policy.
- Guest-admin access is also double-gated: a Worker-managed Cloudflare Access group provides the coarse edge gate, while the worker re-checks event scope and expiry on every request. Do not rely on the Access group alone.
- `/pay` is intentionally excluded from the sitemap (see `astro.config.mjs`).
- `*.workers.dev` URLs are blocked by some browser privacy extensions / Firefox ETP — that's why the worker is on the custom `api.boardgamecompany.in` domain. Always use that URL.
