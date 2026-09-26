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
- `supabase/migrations/` — `001`–`024` (initial schema, guild_path rename, source attribution, price_includes, plus_ones, cancelled status, user_credits, leads, llm_notes, user_promos, guild_path_exclusive, guest admins, waitlist fields, Demon's Draft submissions, corporate events, externally managed registrations, finance ledger, all-day/multi-day events, REPLAY pass perk, community hosts, REPLAY pass claims, Google Photos albums)
  - **New-table grants (from migration `014`+):** Supabase stops auto-exposing `public` tables to the Data API for this project on **2026-10-30**. After that, any new `public` table is invisible to PostgREST until granted — this hits the **worker (`service_role`) too**, not just public `anon` reads. So every new-table migration must include: `grant all on public.<table> to authenticated, service_role;` plus `grant select on public.<table> to anon;` only if the browser reads it directly (pair with RLS). Existing tables keep their grants; no backfill needed.
- `docs/superpowers/specs/` — design specs + implementation plans

## Supabase tables

| Table | Public read | Notes |
|---|---|---|
| `games` | yes | Library, ~200 games. `owned_by` / `currently_with` are internal — never expose to public site |
| `events` | yes (published only via RLS) | `custom_questions` JSONB drives dynamic registration fields. `guild_path_exclusive` gates public registration to active Guild Path members (worker-enforced). `google_photos_url` puts the event's album on `/photos` |
| `users` | no | All registrants ever. `is_community_host` flags people who run sessions for the community |
| `guild_path_members` | no | Membership tiers + expiry (renamed from `guild_members` in migration 002). `never_expires` marks a community host's free Initiate membership; a user can hold several active rows at once |
| `registrations` | no | Spots are summed by `seats` on confirmed rows, not row counts. `is_community_host` marks a free host seat |
| `user_credits` | no | Credit ledger; auto-applied on registration/purchase, idempotent |
| `leads` | no | Partial registration capture (phone+event); auto-converted on registration; admin-managed via `/api/admin/leads*` |
| `user_promos` | no | One-time free-registration grants; apply before guild discounts and credits |
| `event_guest_admins` | no | Event-scoped, time-bound access for collaboration partners |
| `corporate_events` | yes (published only via RLS) | Display-only B2B showcase records; no registration/capacity logic |
| `dd_submissions` | no | Demon's Draft contest submissions |
| `finance_accounts` | no | Private cash-holding locations; one active account can be the guest-confirmation default |
| `finance_categories` | no | Private income/expense categories; transfers deliberately have no category |
| `finance_transactions` | no | Private cash-basis ledger with linked source keys, soft voids, and account movement |
| `finance_import_batches` | no | Private CSV import audit and duplicate-file protection |
| `finance_transaction_history` | no | Append-only audit snapshots for finance transaction changes |
| `replay_pass_claims` | no | Which REPLAY pass numbers have spent their free seat on which event; unique on (event_id, phone) |

## Worker endpoints

**Public:** `POST /api/lookup-phone`, `POST /api/replay-pass-check`, `POST /api/register`, `GET /api/event-spots/:id`, `POST /api/guild-purchase`, `POST /api/lead`, `POST /api/waitlist`, `POST /api/guild-status`, `GET /api/event-photos*`, `POST /api/dd-submit`

`POST /api/guild-status` is not really public: it's the machine-to-machine endpoint REPLAY calls, gated by the shared `REPLAY_TO_BGC_SECRET` bearer token. The reverse direction (this worker asking REPLAY about passes) lives in `worker/src/replay-client.ts`.

**Admin** (gated by Cloudflare Access JWT + `ADMIN_EMAILS` allowlist, all under `/api/admin/`): `whoami`, `summary`, `search`, `log`, `lookup-phone`, `cancel-registration`, `events` (CRUD), `games` (CRUD + `export`, `owners-summary`), `registrations` (list/get/update + `manual` + `export`), `guild-members` (CRUD + `export`), `users` (list/get/update + credit adjustment + `community-host` toggle), `community-hosts` (list + create), `leads` (list + patch junk + `export`), `promos` (CRUD), `corporate-events` (CRUD + logo upload), `finance` (summary/bootstrap, accounts/categories, transaction CRUD/void/restore, import/export).

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
- Positive registration/Guild payments require a finance account, payment date, and method when a full admin confirms them. Database triggers post the linked income atomically using `registration:<id>` / `guild:<id>` source keys. Cancellation credit keeps the original cash transaction; confirmed/paid → pending voids it as a correction.
- Finance migration 019 must be applied before deploying finance-aware Worker/admin code. Run `supabase migration list --linked` first and use the controlled migration path when remote timestamp IDs do not match local numeric IDs.
- Admin API is double-gated: Cloudflare Access JWT (`verifyAccessJwt` in `worker/src/access-auth.ts`) **and** email allowlist (`ADMIN_EMAILS`). Adding an admin = updating the secret + the Cloudflare Access policy.
- Guest-admin access is also double-gated: a Worker-managed Cloudflare Access group provides the coarse edge gate, while the worker re-checks event scope and expiry on every request. Do not rely on the Access group alone.
- Event timing has three shapes: single slot (`date` only), all day (`is_all_day`, no meaningful clock time), and multi-day (`end_date` on a later day). **Never filter upcoming/past on `date`** — use the trigger-maintained `ends_at` column (migration 020), or an event part-way through its run drops off the calendar at its start time. `ends_at` is derived; clients must not write it. Display formatting lives in `src/lib/event-date.ts` with a hand-copied mirror in `admin/src/lib/eventDate.ts` — keep them in sync. Both pin rendering to `Asia/Kolkata`, since every event is at a Bangalore venue; admin *editing* goes through `admin/src/lib/ist.ts` so a form filled in from another timezone still writes venue time. The confirmation-email template is Google Apps Script, outside this repo — see `docs/event-timing-apps-script-snippet.md`.
- **The Photos page has two sources.** Google Drive event folders (named `Event Name M/D/YYYY` under `EVENT_PHOTOS_FOLDER_ID`) and, since migration 024, any published event with a `google_photos_url`. `GET /api/event-photos` merges both newest-first; Drive entries carry `folderId`, Google Photos entries carry `eventId`, and `?event=` takes either, so old Drive links keep working. Google Photos has **no API** for reading an album someone else shared, so `worker/src/google-photos.ts` reads the album's public share page and follows its own `batchexecute` pagination — an undocumented format that can change without notice. Every step fails soft: a failed album read returns 502 and the page offers the album link, a failed later page returns what it has with `complete: false`, and a failed event lookup still serves the Drive list (uncached). Only link-shared albums (`photos.app.goo.gl/…` or `photos.google.com/share/…?key=…`) can be read; the owner's `photos.google.com/album/…` address is rejected with a fix. Google Photos videos can't be embedded, so they open on Google Photos. `lh3` images send no CORS headers, so native sharing goes through `GET /api/event-photos/google-image/:token`. Each album card shows a cover from `GET /api/event-photos/cover/{folder|google}/:id`: a Google Photos album uses the cover its owner set in Google Photos (read from the share page's `og:image`); a Drive folder uses a photo or video whose name starts with `cover` (e.g. `cover - IMG_1234.jpg`), else a landscape shot from the middle of the event by capture time (`pickDriveCover`). A 404 leaves the card on its gradient. A Drive album includes photos in its subfolders at any depth (e.g. one folder per photographer), walked by `listAlbumMedia` and capped at 40 folders per album.
- `/pay` is intentionally excluded from the sitemap (see `astro.config.mjs`).
- `*.workers.dev` URLs are blocked by some browser privacy extensions / Firefox ETP — that's why the worker is on the custom `api.boardgamecompany.in` domain. Always use that URL.
- Events can only be **deleted** while they are still a draft that hasn't happened: `is_published` false, `ends_at` in the future, no `registrations` rows, and no `finance_transactions` linked. The guard lives in `getEventDeletability` (`worker/src/admin/events.ts`) and runs twice — once to tell the admin editor whether to offer the option, and again inside `DELETE /api/admin/events/:id` so a stale form can't slip past it. `leads` and `event_guest_admins` cascade away with the event; guest admins deleted this way trigger a Cloudflare Access group re-sync.
- Events can be flagged `replay_pass_free` (migration 021). Pass ownership lives in the **REPLAY** Supabase project, so the worker asks REPLAY at registration time via `POST https://api.replaycon.in/api/pass-status` (`worker/src/replay-client.ts`, same shared `REPLAY_TO_BGC_SECRET`). Only *confirmed* registrations for the latest REPLAY edition count. The call fails closed: a REPLAY outage means no discount, never a failed registration.
- **The perk covers any attendee, not just the purchaser** (migration 023). A booking may name a phone number per extra seat (`companion_phones`), and every number holding a pass covers its own seat. One pass is one free seat *per event*, whoever's booking it turns up in — enforced by the unique index on `replay_pass_claims (event_id, phone)`, not by application logic. Because of that the claims are staked **before** the registration row exists (the index settles two bookings racing for the same number, and only then is the price knowable), then adopted via `registration_id`; every path out between staking and insert has to release them, and cancelling a registration releases its claims. The purchaser's own pass is one candidate among the rest, skipped when they already hold seats for the event or when the Guild Path just made their own seat free. `POST /api/replay-pass-check` is the advisory per-number check the two forms use while typing; it deliberately answers less than `/api/lookup-phone`, since the person is entering someone else's number.
- **Community hosts** (migration 022) are people who keep running BGC sessions. Three moving parts: `users.is_community_host` flags them, a free `guild_path_members` row (tier `initiate`, `amount` 0, `source` `community_host`, `never_expires` true) gives them a Guild Path floor that never lapses, and `registrations.is_community_host` marks a free host seat. A host seat consumes capacity and must answer the event's required custom questions, but skips the entire price pipeline — no Guild discount, REPLAY pass, promo, or credits are spent, and `amount`/`total_amount` of 0 keeps both finance triggers out of it. Only full admins can create host seats; the guest-admin path rejects `is_community_host` outright.
- Because a host can also buy an upgrade, **a user can now hold more than one active membership**. Never take "the latest-expiring paid row" as the membership in force — use `getActiveMembership` in `worker/src/guild.ts`, which ranks by tier first and expiry second. A never-expiring membership carries the `NEVER_EXPIRES_DATE` sentinel (`2999-12-31`) so every existing `expires_at >= today` filter keeps working untouched; `never_expires` is what UI and exports read, so nobody is shown a year-2999 date. Anything that resolves a membership by recency (e.g. the plus-ones refund in `worker/src/cancel.ts`) must also filter on tier.
- **Nobody registers for two events that start at the same moment.** `findEventClash` (`worker/src/event-clash.ts`) matches on **exact `date` equality**, not overlap — a 15:00 and an 18:00 on the same day are two things one person can do — and on the **phone**, not `user_id`, so a second booking under a fresh name on the same number is still caught. Unpublished events count. Three callers: `/api/register` refuses with 409 `time_clash`, `/api/lookup-phone` returns `clashing_event` so the form can say so before anything is typed, and manual registration warns with `clash_detected` that an admin waves through with `allow_clash` (same shape as `allow_overbook`, and the two overrides accumulate across confirmations). MCP inherits the refusal through `handleRegister`.
- The registration price pipeline runs in a fixed order — effective seat price → Guild Path → REPLAY passes → giveaway promo → credits — and is implemented three times: `worker/src/register.ts`, `worker/src/admin/register-manual.ts`, and the display mirror in `src/components/RegistrationForm.tsx`. Shared steps live in `worker/src/pricing.ts`; the frontend copy must be hand-synced. `applyReplayPassSeats` only zeroes seats — who is eligible, and how many passes were actually claimed, is each caller's job.
