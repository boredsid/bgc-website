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
| `./admin/` | Vite + React + shadcn admin tool → `admin.boardgamecompany.in` | `cd admin && npm run build` then push (Pages) |
| `./worker/` | Cloudflare Worker API → `api.boardgamecompany.in` | `cd worker && npx wrangler deploy` |

Browser reads public `games` / `events` directly from Supabase via anon key + RLS. Anything sensitive (lookup, register, credits, admin) goes through the worker which holds the service-role key.

## Layout

- `src/pages/` — public site routes (Astro)
- `src/components/` — public React islands + Astro partials
- `src/lib/` — `supabase.ts`, `types.ts`, `guild-tiers.ts`, `source.ts` (UTM/source attribution via sessionStorage)
- `worker/src/` — root handlers + `worker/src/admin/` (admin endpoints) + `*.test.ts` (Vitest)
- `admin/src/` — admin SPA, separate package, shadcn-based
- `supabase/migrations/` — `001`–`009` (initial schema, guild_path rename, source attribution, price_includes, plus_ones, cancelled status, user_credits)
- `docs/superpowers/specs/` — design specs + implementation plans

## Supabase tables

| Table | Public read | Notes |
|---|---|---|
| `games` | yes | Library, ~130 games. `owned_by` / `currently_with` are internal — never expose to public site |
| `events` | yes (published only via RLS) | `custom_questions` JSONB drives dynamic registration fields |
| `users` | no | All registrants ever |
| `guild_path_members` | no | Membership tiers + expiry (renamed from `guild_members` in migration 002) |
| `registrations` | no | Spots are summed by `seats` on confirmed rows, not row counts |
| `user_credits` | no | Credit ledger; auto-applied on registration/purchase, idempotent |
| `leads` | no | Partial registration capture (phone+event); auto-converted on registration; admin-managed via `/api/admin/leads*` |

## Worker endpoints

**Public:** `POST /api/lookup-phone`, `POST /api/register`, `GET /api/event-spots/:id`, `POST /api/guild-purchase`, `POST /api/cancel-registration`, `POST /api/cancel-guild-membership`, `POST /api/lead`

**Admin** (gated by Cloudflare Access JWT + `ADMIN_EMAILS` allowlist, all under `/api/admin/`): `whoami`, `summary`, `search`, `log`, `lookup-phone`, `cancel-registration`, `events` (CRUD), `games` (list/get/update + `export`, `owners-summary`), `registrations` (list/get/update + `manual` + `export`), `guild-members` (CRUD + `export`), `users` (list/get/update + credit adjustment), `leads` (list + patch junk + `export`).

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

- **Site / admin:** push to `main` → Cloudflare Pages auto-deploys (separate Pages projects)
- **Worker:** `cd worker && npx wrangler deploy`
- After changing Pages env vars, retry/redeploy from the dashboard for them to take effect

## Design

Orange Energy palette — primary `#F47B20`, bg `#FFF8F0`, secondary `#1A1A1A`, accent `#4A9B8E`, highlight `#FFD166`. Fonts: Space Grotesk (headers), Inter (body). Logo at `public/bgc-logo.png`.

Admin tool uses shadcn defaults — non-coder admins use it, so prefer structured forms with smart defaults / autofill / phone-first lookups over free-text.

## Gotchas

- Astro build runs without `.env.local` access for some imports — `src/lib/supabase.ts` has fallback values so `astro build` doesn't crash; React islands use the real values at runtime.
- `games.owned_by` and `games.currently_with` are internal — never surface in public components.
- Event spot capacity = sum of `seats` across confirmed registrations, not row count. Per-option capacity uses the same weighting.
- `user_credits` is applied automatically on registration / guild purchase. Cancellation credits the user back; the credit logic is idempotent (see `worker/src/credits.ts` + tests).
- Admin API is double-gated: Cloudflare Access JWT (`verifyAccessJwt` in `worker/src/access-auth.ts`) **and** email allowlist (`ADMIN_EMAILS`). Adding an admin = updating the secret + the Cloudflare Access policy.
- `/pay` is intentionally excluded from the sitemap (see `astro.config.mjs`).
- `*.workers.dev` URLs are blocked by some browser privacy extensions / Firefox ETP — that's why the worker is on the custom `api.boardgamecompany.in` domain. Always use that URL.
