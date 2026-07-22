# BGC Website

The website, admin tool, and API for [Board Game Company](https://boardgamecompany.in) — Bangalore's board gaming community.

Public site lists the game library, upcoming events, and the Guild Path membership; members can register for events and pay over UPI. An internal admin tool lets organisers manage events, registrations, members, and credits.

## Stack

- [Astro 5](https://astro.build/) static site with [React 19](https://react.dev/) islands
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Supabase](https://supabase.com/) (Postgres + RLS)
- [Cloudflare Pages](https://pages.cloudflare.com/) for the public site and admin SPA
- [Cloudflare Workers](https://workers.cloudflare.com/) for the API
- [Cloudflare Access](https://www.cloudflare.com/zero-trust/products/access/) for admin auth
- UPI payments via QR + deep links (GPay / PhonePe / Paytm)

## Repo layout

| Path | What |
|---|---|
| `./` | Public Astro site → [boardgamecompany.in](https://boardgamecompany.in) |
| `admin/` | Vite + React + shadcn admin SPA → admin.boardgamecompany.in (Cloudflare Access gated) |
| `worker/` | Cloudflare Worker API → api.boardgamecompany.in |
| `supabase/migrations/` | Postgres schema + RLS policies |
| `docs/` | Design specs and implementation plans |

## Architecture

The browser reads public data (`games`, `events`) directly from Supabase using the anon key with row-level security. Anything sensitive — phone lookup, registration, guild purchase, credits, admin actions — goes through the Cloudflare Worker, which holds the Supabase service-role key as a secret.

Admin endpoints (`/api/admin/*`) are double-gated: a Cloudflare Access JWT is verified inside the worker, and the email is checked against an allowlist.

## Running locally

You need Node 20+ and a `.env.local` with Supabase keys for the public site. The worker uses `wrangler` for local dev and `wrangler secret put` for secrets.

```bash
# Public site
npm install
npm run dev                       # http://localhost:4321

# Worker API
cd worker
npm install
npm run dev                       # http://localhost:8787
npm test

# Admin SPA
cd admin
npm install
npm run dev
```

Required environment variables for the public site (`.env.local`):

```
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
PUBLIC_WORKER_URL=
PUBLIC_UPI_ID=
```

Worker secrets and vars are documented in [`AGENTS.md`](./AGENTS.md).

## Deployment

- **Site / admin:** auto-deploy from `main` via Cloudflare Pages (separate Pages projects).
- **Worker:** `cd worker && npx wrangler deploy`.

## Contributing

This is the production codebase for a small community organisation, so it isn't really set up to take outside contributions. If you've spotted a bug or have an idea, feel free to open an issue.

## License

All rights reserved. The code is published for transparency, not for reuse.
