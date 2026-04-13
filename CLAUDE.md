# BGC Website

Board Game Company website — Bangalore's board gaming community.

## Stack

- **Astro 5** (static site generator) + **React** islands for interactive components
- **Tailwind CSS 4** (CSS-based config in `src/styles/global.css`)
- **Supabase** (PostgreSQL + RLS) — project ref: `yhgtwqdsnrslcgdvmunz`
- **Cloudflare Pages** (static hosting) — auto-deploys from GitHub on push
- **Cloudflare Workers** (API layer) — deployed separately via `cd worker && npx wrangler deploy`
- **UPI payments** via QR codes + deep links (GPay, PhonePe, Paytm)

## Architecture

- Static Astro pages for SEO. React islands (`client:load`) for dynamic content.
- Browser reads public data (games, events) directly from Supabase using the **anon key** + RLS.
- Sensitive operations (phone lookup, registration, membership checks) go through the **Cloudflare Worker**, which holds the Supabase **service role key** as a secret.
- The browser never sees the service role key.

## Key Files

- `src/pages/` — 5 pages: index, library, guild-path, calendar, register
- `src/components/` — React islands (GameLibrary, EventList, RegistrationForm, PaymentSheet) + Astro components (Nav, Footer)
- `src/lib/types.ts` — shared TypeScript interfaces
- `src/lib/supabase.ts` — browser Supabase client (uses `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`)
- `worker/src/` — Cloudflare Worker with 3 endpoints: `lookup-phone`, `register`, `event-spots`
- `worker/src/validation.ts` — phone/email/name sanitization helpers
- `supabase/migrations/001_initial_schema.sql` — all tables + RLS policies
- `docs/superpowers/specs/2026-04-13-bgc-website-design.md` — full design spec

## Supabase Tables

| Table | Public Read | Notes |
|-------|-----------|-------|
| `games` | Yes | Board game library, ~130 games |
| `events` | Yes (published only) | `is_published = true` filter via RLS |
| `users` | No (Worker only) | Stores all users who've ever registered |
| `guild_members` | No (Worker only) | Membership tiers + expiry dates |
| `registrations` | No (Worker only) | Event registrations |

## Worker API (`/api/*`)

- `POST /api/lookup-phone` — returns user info + guild membership for a phone number
- `POST /api/register` — validates, calculates discounts, writes registration + upserts user
- `GET /api/event-spots/:event_id` — returns remaining spots + per-option capacity counts

## Environment Variables

**Astro (Cloudflare Pages env vars + `.env.local` for local dev):**
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_WORKER_URL`

**Worker (`worker/wrangler.toml` vars + secrets):**
- `SUPABASE_URL` (in wrangler.toml)
- `SUPABASE_SERVICE_KEY` (secret — set via `wrangler secret put`)

## Development

```bash
npm run dev          # Astro dev server on :4321
cd worker && npm run dev  # Worker dev server on :8787
```

## Deployment

- **Site:** Push to GitHub → Cloudflare Pages auto-deploys
- **Worker:** `cd worker && npx wrangler deploy`
- **After changing Cloudflare Pages env vars:** Must retry/redeploy from the dashboard for changes to take effect

## Design

- **Palette:** Orange Energy — primary #F47B20, bg #FFF8F0, secondary #1A1A1A, accent #4A9B8E, highlight #FFD166
- **Fonts:** Space Grotesk (headers), Inter (body)
- **Logo:** `public/bgc-logo.png` — orange circle with black "BGC"

## Gotchas

- Supabase client in `src/lib/supabase.ts` has fallback values for build time (env vars aren't available during `astro build`). This is intentional — React islands use the real values at runtime.
- The `games` table has `owned_by` and `currently_with` columns that are internal-only — never expose these in the frontend.
- UPI ID is hardcoded in `src/components/PaymentSheet.tsx` — update it there if it changes.
- Registration spots are counted by summing `seats` across confirmed registrations, not by counting rows.
- Events have an optional `custom_questions` JSONB field that drives dynamic form fields on the registration page.
