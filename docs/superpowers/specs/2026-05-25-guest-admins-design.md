# Guest Admins — Design Spec

**Date:** 2026-05-25
**Status:** Approved design, pending implementation plan

## Problem

BGC frequently co-hosts events with other communities. We want to give a
collaboration partner temporary, narrowly-scoped access to the admin tool: they
should be able to manage registrations for *their* collaboration event and see
nothing else. Access must be both **event-bound** and **time-bound** (auto-expiring
after the event).

## Requirements (confirmed)

- An admin can mark an event as a **collaboration** and attach a list of guest
  email addresses to it.
- Those emails can log into `admin.boardgamecompany.in` exactly like an admin
  (via Cloudflare Access OTP / IdP).
- A guest admin sees **only** the registrations for their collaboration event(s).
  No dashboard, games, users, guild, leads, promos, summary, or other events.
- For their event's registrations, guests have full powers: **view full
  registrant details, edit/update, add manual registrations, and cancel**
  (cancellation triggers the usual idempotent credit-back logic).
- Access **auto-expires** 2 days after the event date. No manual date picking.
- Guest emails are **auto-synced into Cloudflare Access** via the CF API so they
  pass the edge gate without manual dashboard work.
- Manual-add phone lookup for guests is **scoped**: returns only name/email +
  seats-for-this-event for autofill. Membership tier, credit balance, promos, and
  cross-event history are hidden from the collaboration partner.

## Architecture: isolated guest surface

A guest's request never enters the existing admin `if/else` routing chain, and a
guest never loads the existing admin SPA shell. Both the worker and the frontend
branch on role into a separate, small, auditable surface. A guest *physically
cannot* reach admin-only code paths — the entire guest blast radius lives in one
worker module and one SPA shell.

Rejected alternatives:
- **Role flag woven through shared handlers** — one missed `eventId` check = data
  leak. Too fragile for an access-control boundary.
- **Separate guest worker / subdomain** — cleanest isolation but unjustified infra
  overhead (second worker, second CF app).

## Data model

### `events.is_collaboration`
```sql
alter table events add column is_collaboration boolean not null default false;
```
The explicit "mark as collaboration" toggle **and** master kill-switch. Turning it
off instantly revokes all guests for that event (worker re-checks it on every
request; CF Access group is pruned on next sync).

### New table `event_guest_admins`
```sql
create table event_guest_admins (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  email text not null,                  -- stored lowercased
  created_at timestamptz not null default now(),
  created_by text,                      -- admin email who added them
  unique (event_id, email)
);
create index on event_guest_admins (email);
```

No expiry column. A guest is **active** iff:
```
event.is_collaboration = true
AND now() < (event.date + interval '2 days')
```
Expiry is always derived from the event date — single source of truth, nothing to
keep in sync. Migration number: next free (`014_event_guest_admins.sql`).

RLS: no public access (service-role only, like other admin tables).

## Worker

### Auth split (`access-auth.ts`)

`verifyAccessJwt` currently does two jobs: (1) cryptographic verification of the
JWT (signature, `iss`, `aud`, `exp`) and (2) the `ADMIN_EMAILS` allowlist check.
Split them:

- `verifyAccessJwt` keeps job (1) and returns the verified `email` for **any**
  validly-signed token. It no longer rejects on `ADMIN_EMAILS`.
- The allowlist / role decision moves up into `gateAdmin`.

Existing `access-auth.test.ts` will be updated to reflect that the allowlist check
moved out.

### `gateAdmin` role resolution (`index.ts`)

```ts
type Role = 'admin' | 'guest';
type AdminContext =
  | { email: string; role: 'admin' }
  | { email: string; role: 'guest'; eventIds: string[] };
```

Flow:
1. Verify JWT → `email` (or 401).
2. If `email ∈ ADMIN_EMAILS` → `{ role: 'admin' }`.
3. Else resolve active guest events: query `event_guest_admins` joined to `events`
   where `email = X AND events.is_collaboration = true AND events.date + 2d > now()`.
   If any rows → `{ role: 'guest', eventIds: [...] }`.
4. Else → 403.

Dev escape hatch (`ENVIRONMENT=development`) keeps returning a full admin.

### Routing branch (`index.ts`)

```ts
if (gate.admin.role === 'guest') {
  response = await handleGuestRequest(url, request, env, ctx, gate.admin);
} else {
  // ...existing admin if/else chain unchanged...
}
```

### `handleGuestRequest` (new module `worker/src/guest/index.ts`)

The complete set of endpoints a guest can reach. Every handler re-verifies the
target event is in `admin.eventIds`; anything else → 403.

| Method + path | Behavior for guest |
|---|---|
| `GET /api/admin/whoami` | Returns `{ email, role: 'guest', events: [{id, name, date}] }` for active events only. |
| `GET /api/admin/registrations` | `event_id` query param forced to a value in `eventIds`; if omitted and the guest has one event, defaults to it; if omitted with multiple, returns 400. Never returns rows outside `eventIds`. |
| `GET /api/admin/registrations/:id` | Loads the reg, 403 if its `event_id ∉ eventIds`. |
| `PATCH /api/admin/registrations/:id` | Same event check, then normal update. |
| `POST /api/admin/registrations/manual` | `event_id` in body forced to be in `eventIds` (400 otherwise). |
| `POST /api/admin/cancel-registration` | Load reg, 403 if event not allowed, then normal cancel (idempotent credit-back). |
| `GET /api/admin/events/:id` | 403 if not in `eventIds`. Used only to render the event header. |
| `POST /api/admin/lookup-phone` | **Scoped** variant (see below). |
| `POST /api/admin/log` | Allowed (client logging). |
| anything else | 403. |

### Scoped phone lookup

New scoped path reusing the registration-seats query but stripping member
economics. For guests, `lookup-phone` returns:
```jsonc
{ "user": { "found": bool, "name": string|null, "email": string|null },
  "existing_seats_for_event": number }
```
No `membership`, `credit_balance`, or `active_promo`. The `event_id` it counts
seats for must be in `eventIds`. The manual-registration drawer must tolerate the
missing fields when in guest mode (treat as non-member, no credit, no promo).

### Events PATCH (`worker/src/admin/events.ts`)

`handleUpdateEvent` accepts `is_collaboration` and a `guest_admins` email array
(admin-only — guests never reach this handler). On update it:
1. Upserts/deletes rows in `event_guest_admins` to match the submitted list
   (emails lowercased, de-duped, basic email-shape validation).
2. Triggers a CF Access group sync (see below).

`handleGetEvent` / `handleListEvents` include `is_collaboration` and the guest
email list so the admin UI can render them.

### Cloudflare Access sync (`worker/src/guest/cf-access.ts`)

One dedicated **CF Access Group** ("BGC Guest Admins") is added as an include rule
on the admin application's Access policy (one-time manual setup). The worker owns
the group's membership and rewrites it via the CF API:

```
PUT https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/access/groups/{CF_ACCESS_GROUP_ID}
Authorization: Bearer {CF_API_TOKEN}
Body: { name, include: [ {email:{email:"a@x.com"}}, ... ] }
```

The `include` list = **all currently-active guest emails across every
collaboration** (recomputed from the DB each sync). Sync runs:
- On `handleUpdateEvent` when the guest list or `is_collaboration` changes
  (fire-and-forget via `ctx.waitUntil`).
- Daily from the existing `scheduled` cron handler, to prune emails whose events
  have passed the 2-day buffer.

**The worker is the source of truth on expiry** — it re-checks `is_collaboration`
and the date buffer on every request in `gateAdmin`. The CF group is an
eventually-consistent coarse gate whose only job is to let the request reach the
worker. A stale CF entry can never grant access the worker would deny.

New worker secrets (added via `wrangler secret put`):
- `CF_API_TOKEN` — scoped to **Access: Edit** on the account.
- `CF_ACCOUNT_ID`
- `CF_ACCESS_GROUP_ID`

If these are unset (e.g. local dev), sync is skipped with a warning; DB-side guest
logic still works for testing.

## Admin SPA

### whoami provider

A `whoami` fetch at the app root (`App.tsx`) provides `{ email, role, events }` via
context. Branch on role:
- `admin` → existing `<Routes>` unchanged.
- `guest` → `<GuestApp>` minimal shell.

While loading, show the existing `<Loading>`. On 401 the api client already
reloads (CF Access re-auth).

### `<GuestApp>` shell

- No `Sidebar`, no `BottomTabBar`, no `TopBar` search/nav. A slim header showing
  the event name (and a switcher if multiple events) + sign-out.
- One active event → land directly on that event's scoped registrations list.
- Multiple → a tiny event picker, then the scoped list.
- Any unknown path → redirect to the guest's registrations.

### Component reuse

Reuse `RegistrationsList`, `RegistrationDrawer`, `ManualRegistrationDrawer` with
the event **locked** to the guest's selection:
- `RegistrationsList`: event filter is fixed/hidden in guest mode; `event_id` always
  sent. Bulk actions and per-row edit/cancel/manual all work against the scoped API.
- `ManualRegistrationDrawer`: event preset and locked; tolerates the scoped
  lookup-phone response (no membership/credit/promo → treat as plain guest).

Implementation may pass a `guestEventId` prop or read it from the whoami context;
the plan will pick the cleaner wiring.

### `EventDrawer` collaboration controls (admin side)

In the admin `EventDrawer`:
- A **"Collaboration"** toggle (`is_collaboration`).
- When on, reveal a **guest email editor** — chip/list input for adding/removing
  emails (mirrors the low-friction, structured-input ethos of the admin tool).
- A short note that access auto-expires 2 days after the event date.
- Saved through the existing events PATCH endpoint.

## Testing

Worker (Vitest):
- `gateAdmin` role resolution: admin email → admin; active guest email → guest with
  correct `eventIds`; expired guest (event > 2d past) → 403; guest on a
  non-collaboration event → 403; unknown email → 403.
- `handleGuestRequest`: each allowed endpoint scoped correctly; registrations list
  never returns out-of-scope rows; `:id` GET/PATCH/cancel 403 on foreign event;
  manual register rejects foreign `event_id`; every admin-only path → 403.
- Scoped lookup-phone omits membership/credit/promo.
- `handleUpdateEvent` upserts/deletes `event_guest_admins` correctly and triggers
  sync.
- CF Access sync: builds the correct active-email set; no-ops cleanly when secrets
  are unset.

Admin (Vitest/RTL):
- whoami provider branches admin vs guest.
- `<GuestApp>`: single-event lands on scoped list; multi-event picker; unknown route
  redirects.
- `ManualRegistrationDrawer` handles scoped lookup response.

## Out of scope / non-goals

- Per-guest custom expiry dates (always event date + 2 days).
- Guests editing event details, games, users, guild, leads, or promos.
- Guests exporting CSV (not in the confirmed power set; can be added later).
- A separate guest login domain or second worker.

## One-time operational setup

1. Create the "BGC Guest Admins" CF Access Group; add it as an include rule on the
   admin app's Access policy.
2. Create a CF API token scoped to **Access: Edit**.
3. `wrangler secret put CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ACCESS_GROUP_ID`.
4. Run migration `014_event_guest_admins.sql`.
