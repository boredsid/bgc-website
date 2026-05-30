# Event Waitlist — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Problem

When an event sells out, the public registration form (`src/components/RegistrationForm.tsx`)
shows a static "Sold Out" card — a dead-end. Interested people leave with no way to
signal demand, and BGC loses the signal entirely. We want sold-out events to let people
**join a waitlist** instead, and have those entries land in the existing `leads` table so
admins can work them with the tooling that already exists.

## Goals

- Replace the sold-out dead-end with a waitlist form (phone, name, email, seats).
- Persist waitlist joins as `leads` rows, distinguished from ordinary abandoned leads.
- Send the joiner a confirmation email.
- Surface the waitlist in admin `/leads` with a dedicated filter, badge, and seat count,
  ordered FIFO by join time.
- **Manual flow:** admins contact waitlisters (existing WhatsApp deep-links) when a spot
  frees up. No auto-notify, no auto-promote.

## Non-goals (YAGNI)

- No automatic notification when a registration cancels and frees capacity.
- No auto-promotion of a waitlister into a real registration / payment hold.
- No per-event toggle — the waitlist is always on for sold-out published events.
- No waitlist at the custom-question *option* level. The waitlist appears only when the
  **whole event** is sold out (`remaining <= 0`).

## Architecture

The waitlist is an extension of the existing **leads pipeline**, not a new table.

- A waitlist entry is a `leads` row marked with a new `waitlist_at` timestamp (which also
  gives natural FIFO ordering).
- A new worker endpoint `POST /api/waitlist` does an explicit, validated submit (in
  contrast to the silent debounced `/api/lead` capture), upserts into `leads` with email +
  seats + `waitlist_at`, then fires a confirmation email best-effort.
- The public `RegistrationForm.tsx` sold-out branch becomes a real waitlist form.
- Admin `/leads` gains a waitlist filter + badge + seats column; export includes the new
  fields.

## Data model — migration `015_leads_waitlist.sql`

Add three nullable columns to the existing `leads` table:

```sql
alter table leads add column email text;
alter table leads add column seats int;
alter table leads add column waitlist_at timestamptz;

create index leads_waitlist_idx on leads (waitlist_at desc)
  where waitlist_at is not null and junk_at is null;
```

- `leads` is an existing table, so it keeps its current grants — no new `grant` needed.
- **`waitlist_at`** is the canonical marker: `null` = ordinary abandoned lead, non-null =
  waitlist join. The partial index keeps the admin "waitlist only" query cheap.
- **`last_step`** is unchanged; waitlist joins set it to `'details_entered'` (they did
  submit all fields), so the existing check constraint is not touched. `waitlist_at` is
  what distinguishes intent.
- `email` / `seats` are nullable so existing rows and the silent `/api/lead` capture
  (which collects neither) are unaffected.
- The existing `unique (phone, event_id)` constraint means a person who already abandoned
  a lead for this event and then joins the waitlist updates the **same** row
  (email/seats/`waitlist_at` filled in) — no duplicate.

## Worker endpoint — `POST /api/waitlist`

New file `worker/src/waitlist.ts`, wired into the flat `if/else` chain in
`worker/src/index.ts`.

Request body: `{ event_id, name, phone, email, seats, source?, user_agent? }`

Logic:

1. Validate with existing helpers: `sanitizePhone`, `sanitizeName`, `sanitizeEmail`,
   `seats` in 1–20, `event_id` is a UUID (`UUID_RE`).
2. Fetch the published event. 404 if missing.
3. **Re-check capacity server-side** using the same `sum(seats)` over non-cancelled
   registrations as `register.ts`. If `remaining >= 1`, the event is not actually full —
   return `{ available: true }` (stale client). This also prevents abusing the endpoint to
   dump junk leads for events that are not full.
4. Skip if the matching `(phone, event_id)` lead is already `converted_at` (they are
   actually registered) — return `{ success: true }` without changes.
5. Upsert into `leads` on `(phone, event_id)`:
   - `name`, `email`, `seats`, `source`, `user_agent`
   - `last_step = 'details_entered'`
   - `waitlist_at = now()` **only if not already set** — preserve the original FIFO
     position on re-submit (read the existing row first / conditional update).
   - `updated_at = now()`
6. Fire `sendWaitlistEmail(...)` via `ctx.waitUntil` (best-effort; a send failure never
   fails the request).
7. Return `{ success: true }`.

Reuse `lead.ts`'s per-isolate rate-limit and `eventExists`-style guards for consistency
and abuse resistance.

## Public UI — `RegistrationForm.tsx`

Replace the sold-out dead-end (current lines ~378–382) with a waitlist form:

- Heading: "This event is full — join the waitlist", plus one line stating admins will
  reach out if a spot opens.
- Fields: phone (reuses the existing input; `useLeadCapture` keeps firing), name, email,
  and the existing seats stepper (capped at 10; no `remaining` cap since it is 0).
- Submit → `POST /api/waitlist`:
  - `{ available: true }` → show "Good news — a spot just opened! Refreshing…" and re-fetch
    `/api/event-spots/:id` so the normal registration form returns.
  - `{ success: true }` → waitlist success state: "You're on the list for {event} — we'll
    WhatsApp or email you if a spot frees up."
- Reuses the existing Orange-Energy `card-brutal` styling already in the file.

## Confirmation email — `worker/src/email.ts`

Add `sendWaitlistEmail`, mirroring `sendEventRegistrationEmail`'s shape (to, name, event
name/date/venue). Subject approximately "You're on the waitlist for {event}". No payment
block.

## Admin

**Worker** `worker/src/admin/leads.ts`:

- Add `email, seats, waitlist_at` to the list and export `select`.
- Extend `applyListFilters` with a `waitlist` query param: `only` (`waitlist_at` not null) /
  `exclude` (`waitlist_at` is null) / unset = both.
- Export gains `waitlist_at` and `seats` columns.

**`admin/src/pages/Leads.tsx`**:

- Add a "Waitlist" select (Any / Waitlist only / Hide waitlist).
- Show a 🎟️ Waitlist badge + seat count on waitlist rows.
- When "Waitlist only", order by `waitlist_at` ascending (FIFO).
- Existing WhatsApp deep-link covers outreach.

## Testing

- `worker/src/waitlist.test.ts` (Vitest, mirrors `lead.test.ts` / `register.test.ts`):
  - rejects invalid input (bad phone/name/email/seats/event_id);
  - returns `{ available: true }` when the event is not full;
  - upserts a waitlist row when full;
  - preserves `waitlist_at` on re-submit;
  - does not touch already-converted leads.
- Extend `worker/src/admin/leads.test.ts` for the `waitlist` filter param.

## Deployment

- Apply migration `015` to Supabase.
- Worker: `cd worker && npx wrangler deploy`.
- Site: push to `main` (Cloudflare Pages auto-deploys).
- Admin: `cd admin && npm run build` then push.
