# BGC Admin Tool — Design Spec

**Date:** 2026-05-01
**Status:** Approved
**Domain:** `admin.boardgamecompany.in`

## Goal

Provide an admin web tool for ~4 non-technical BGC admins to manage events, the board game library, registrations, and guild path memberships, plus a dashboard summarising upcoming and recent past events. PWA-installable on mobile.

## Audience

4 admins, non-coders. UX must use plain English, structured forms (no raw JSON), and confirmations for destructive or irreversible actions.

## Architecture

### Hosting

- New Cloudflare Pages project `bgc-admin`, source at `admin/` in this repo (sibling to `worker/`).
- Stack: Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui + React Router.
- Build output: `admin/dist`. Build command: `cd admin && npm install && npm run build`.
- Custom domain `admin.boardgamecompany.in` on the Pages project; CNAME via Cloudflare DNS.

### Authentication

- Cloudflare Access self-hosted application policy on `admin.boardgamecompany.in`.
- Allow rule with 4 explicit emails. Session duration **720h (1 month — Access maximum)**. After expiry, user gets one-click re-auth via existing identity provider session; PWA install survives.
- Access handles login entirely. The app sees authenticated requests or doesn't load.

### API

- Existing Cloudflare Worker (`worker/`) gains a new `/api/admin/*` namespace.
- Every `/api/admin/*` request verifies the `Cf-Access-Jwt-Assertion` header (signature, `iss`, `aud`, `exp`) using Cloudflare's published signing keys, cached per Worker isolate.
- Defense-in-depth: Worker also checks the JWT `email` claim against an `ADMIN_EMAILS` allowlist env var.
- Existing un-authed `/api/admin/cancel-registration` and `/api/admin/cancel-guild-membership` endpoints fold under the same JWT verification (closes existing hole).

### Data plane

- Worker continues to use Supabase service role key. Admin frontend never talks to Supabase directly.
- No RLS changes. No new anon access.

## Schema changes

**None.** Existing tables and columns are sufficient.

- Manual registrations created via the admin tool reuse the existing `registrations.source` column with value `'admin'`.
- No `is_active` flag on games — games cannot be deleted from the UI; removal happens via Supabase dashboard if ever needed.
- No audit-log table. Cloudflare Access logs admin sign-ins; that's enough for v1.

## Routes

```
/                          Dashboard (default after login)
/events                    Events list
/events/new                Create event (drawer)
/events/:id                Edit event (drawer)
/games                     Games list
/games/new                 Create game (drawer)
/games/:id                 Edit game (drawer)
/registrations             Registrations list
/registrations/new         Manual registration (drawer)
/registrations/:id         Edit registration (drawer)
/guild                     Guild members list
/guild/:id                 Edit guild member (drawer)
```

Drawer routes overlay their parent list route — closing the drawer returns to the list, URL is shareable.

## App layout

- Left sidebar (collapsible to icons-only on mobile): Dashboard, Events, Games, Registrations, Guild.
- Top bar: page title, signed-in admin email (read from JWT), "Sign out" link → `/cdn-cgi/access/logout`.
- Mobile: sidebar becomes a hamburger drawer.

## Pages

### Dashboard

Landing page after login. Two sections:

- **Upcoming events** — expanded by default, cards sorted by date ascending.
- **Past events** — collapsed by default ("▸ Past events (N)"), capped at the **last 3 events**, sorted by date descending. Older events accessible via the registrations list's event filter.

Each card shows:
- Event name, date, venue.
- Capacity bar (confirmed seats / total capacity).
- Registration status counts: pending / confirmed / cancelled.
- Guild member share: "X of Y confirmed are guild members".
- Custom-question summary expandable inline:
  - Multiple-choice (`select`/`radio`): bar/count per option.
  - Boolean (`checkbox`): yes/no counts.
  - Free text (`text`): collapsed by default with count, click-to-expand reveals all answers.
- "View registrations" link → `/registrations?event=<id>` (filtered list).

### Events list

- Table: name, date, venue, capacity (confirmed/total), published toggle, action.
- "New event" CTA opens create drawer.
- Click a row → edit drawer.

### Games list

- Table: title, player count, complexity, owned-by, currently-with.
- Search box (full-text on title).
- Quick filter by `currently_with`.
- "Add game" CTA. No delete.

### Registrations list

- Table: name, phone, event, seats, total, payment_status, created_at, source.
- Filters: event (dropdown including past events with "(past)" suffix and a separator), payment_status.
- "New manual registration" CTA opens manual registration drawer.
- Click row → edit drawer (any field editable, including payment_status).

### Guild members list

- Table joins `guild_path_members` with `users` (via `user_id`) to display name, phone, email.
- Columns: name, phone, tier, starts_at, expires_at, status, plus_ones_used.
- Filters: status (`pending` / `paid` / `cancelled`), tier (`initiate` / `adventurer` / `guildmaster`).
- Click row → edit drawer. Editable fields: tier, amount, status, starts_at, expires_at, plus_ones_used. The associated user (name/phone/email) is edited via a separate "Edit user" link in the drawer that opens the underlying `users` row.

## Drawer pattern

- Right-side drawer over the list, full-screen sheet on mobile.
- Contains the full editable record. All columns editable except IDs and timestamps.
- Save / Cancel buttons. Cancel with dirty form opens a "Discard changes?" confirm dialog.
- For events with custom questions, the editor is a structured per-question form. Question type dropdown shows non-technical labels: "Pick one (dropdown)" → `select`, "Pick one (radio)" → `radio`, "Short text" → `text`, "Yes/no" → `checkbox`. Each question has label, required toggle, and drag-to-reorder. For `select`/`radio`, nested option editor with value + optional per-option capacity.
- Editing custom questions on an event that already has registrations shows a non-blocking warning explaining that renaming options can break stored answers.
- IDs for custom questions auto-generated as `slug(label)` with collision suffix; renaming a label preserves the ID to keep stored answers stable.

## Manual registration flow

Drawer fields:
1. Event picker (defaults to next upcoming).
2. Phone number → on blur, calls `/api/admin/lookup-phone` → autofills name, email, guild membership, prefills discount and plus-ones-remaining.
3. Name, email (editable).
4. Seats.
5. Custom-question answers (rendered from event's `custom_questions`).
6. Payment status (`pending` / `confirmed`, default `confirmed`).

Behaviour:
- Reuses discount + capacity logic from public `register.ts`.
- Skips UPI flow entirely.
- Sets `source = 'admin'`.
- Sends the standard registration confirmation email if email is present.

## Worker API

All endpoints live under `/api/admin/*` and require a valid Access JWT.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/admin/summary` | GET | Dashboard data — upcoming and last 3 past events with counts, guild share, custom-question aggregates |
| `/api/admin/events` | GET, POST | List all events (incl. unpublished); create event |
| `/api/admin/events/:id` | GET, PATCH | Read/update single event |
| `/api/admin/games` | GET, POST | List all games; create game |
| `/api/admin/games/:id` | GET, PATCH | Read/update single game |
| `/api/admin/registrations` | GET | List with `?event_id=` and `?status=` filters |
| `/api/admin/registrations/:id` | GET, PATCH | Read/update single registration (incl. payment_status) |
| `/api/admin/registrations/manual` | POST | Create manual registration |
| `/api/admin/guild-members` | GET | List with filters; joins `users` for name/phone/email |
| `/api/admin/guild-members/:id` | GET, PATCH | Read/update single member (tier, amount, status, dates, plus_ones_used) |
| `/api/admin/users/:id` | GET, PATCH | Read/update underlying user row (name, phone, email) — used by guild member drawer's "Edit user" link |
| `/api/admin/lookup-phone` | POST | Phone → user info + guild status (for manual registration drawer) |
| `/api/admin/cancel-registration` | POST | Existing endpoint, now JWT-verified |
| `/api/admin/cancel-guild-membership` | POST | Existing endpoint, now JWT-verified |

PATCH handlers accept partial payloads, validate only provided fields, write only changed columns.

### Summary endpoint shape

```ts
{
  upcoming: SummaryCard[],
  past: SummaryCard[]  // capped at 3
}

type SummaryCard = {
  event: Event,  // full event row
  totals: { pending: number, confirmed: number, cancelled: number },
  guild_member_count: number,  // confirmed regs whose user_id matches a guild_path_members row with status='paid' and expires_at >= event date
  capacity_used: number,       // sum of seats across confirmed registrations
  custom_question_summary: Record<questionId, QuestionSummary>  // aggregated over confirmed registrations only (excludes pending and cancelled)
}

type QuestionSummary =
  | { type: 'select'|'radio', counts: Record<optionValue, number> }
  | { type: 'checkbox', yes: number, no: number }
  | { type: 'text', count: number, answers: string[] }
```

## Worker auth verification

New file `worker/src/access-auth.ts`:

- Fetches Cloudflare's signing keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
- Caches keys in-memory per Worker isolate, refreshes on `kid` miss.
- Verifies signature, `iss` (team domain), `aud` (Application AUD tag), `exp`.
- Extracts `email` claim, checks against `ADMIN_EMAILS` allowlist.
- Returns 401 with generic error on any failure.

New env vars in `worker/wrangler.toml`:
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `ADMIN_EMAILS` (comma-separated)
- `ENVIRONMENT` (`development` | `production`) — gates dev auth bypass

## PWA

- `admin/public/manifest.json` — name "BGC Admin", short_name "BGC Admin", display `standalone`, 192/512 PNG icons, theme color from utilitarian admin palette.
- iOS meta tags in `index.html` (`apple-mobile-web-app-capable`, `apple-touch-icon`).
- Minimal service worker (`admin/src/sw.ts`) — caches app shell only (Vite-hashed HTML/JS/CSS). No data caching. `skipWaiting` on new build.
- "Add to Home Screen" via native browser prompt; no in-app install button in v1.

## Error handling

- All Worker calls go through one `fetchAdmin()` wrapper in `admin/src/lib/api.ts`:
  - 401 → reload page to trigger Access re-challenge.
  - 4xx → toast with server `error` field.
  - 5xx → toast "Something went wrong, try again."
- Toasts via shadcn/ui `sonner`.
- Forms: client-side validation before submit; server-side validation echoed as field-level errors. All messages plain English.
- Drawer dirty-state tracked; closing with unsaved changes opens a confirm dialog.

## Testing

- Worker:
  - vitest unit tests for the JWT verifier (valid, expired, wrong audience, wrong issuer, email not in allowlist, missing header, malformed JWT).
  - vitest tests for the manual-registration handler (capacity check, `source='admin'`, discount logic).
  - Mock Supabase via existing pattern in `worker/`.
- Admin frontend:
  - vitest + React Testing Library on the manual-registration drawer and the dashboard summary card.
- No E2E in v1.

## Local dev

- `npm run dev` in `admin/` runs Vite at a local port.
- Worker `dev` mode (`ENVIRONMENT=development`) accepts a dev JWT signed with a local shared secret instead of Cloudflare's keys, only when origin is `localhost`. Production never takes this path.
- The dev frontend mints the dev JWT using a `VITE_DEV_ADMIN_EMAIL` env var.

## Deployment

- **Site:** push to GitHub → Cloudflare Pages auto-deploys both `bgc-website` and `bgc-admin` (the latter only rebuilds on changes under `admin/`).
- **Worker:** `cd worker && npx wrangler deploy` after setting the new env vars (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`, `ENVIRONMENT`).
- **Cloudflare Access:** create the application policy via Zero Trust dashboard; allow rule with 4 emails; session duration 720h.

## Out of scope (v1)

- Hard deletes (events, games, registrations, guild members)
- Audit log / change history
- Bulk CSV import
- Email broadcasts to registrants
- Refund tracking beyond `cancelled` status
- BoardGameGeek autofill for new games

## Open questions

None at spec time.
