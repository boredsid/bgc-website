# Guild Path Exclusive Events — Design

**Date:** 2026-05-24
**Status:** Draft

## Problem

Some events should be open only to current Guild Path members. Today every published event is registerable by anyone with a phone number. We need:

- An admin-controlled per-event flag marking the event as Guild Path exclusive.
- A clear public-site UX that surfaces the restriction up front, gates registration after phone lookup, and routes non-members toward joining Guild Path.
- Server-side enforcement so the restriction cannot be bypassed by a hand-crafted request.

## Goals / non-goals

**Goals**
- Add `events.guild_path_exclusive` flag with a simple admin toggle.
- Show a visible "Guild Path Exclusive" badge on event cards and event pages so users know in advance.
- After phone lookup on the register page, replace the registration form with a Guild Path CTA when the user isn't a current member.
- Enforce in the worker `POST /api/register` handler.
- Let admins override via the admin manual-registration flow, with a warning.

**Non-goals**
- No new pricing/tier logic. Exclusive events do not get a separate member price; existing `member_discount`/tier discount stays as-is.
- No filter on `/calendar` to "show only exclusive events" — out of scope.
- No notion of expired-but-renewable nudge inside the gate (just a single "Join Guild Path" CTA).

## Schema

Migration `013_event_guild_exclusive.sql`:

```sql
alter table events
  add column guild_path_exclusive boolean not null default false;
```

No RLS change required — the column reads through with the existing `events` policies.

## Type changes

`src/lib/types.ts` — add to `Event`:

```ts
guild_path_exclusive: boolean;
```

Same shape used in admin (`admin/src/lib/types.ts` or equivalent) — confirm during implementation.

## Public site

### Event card / calendar tile
Render a pill-style "Guild Path Exclusive" badge using the existing highlight color (`#FFD166` background, `#1A1A1A` text) when `event.guild_path_exclusive === true`. Placement: near the existing date/venue chips on the card.

### Event detail / register page header
Same badge in the event header area, so the user sees it before scrolling to the form.

### Register page gate (post phone-lookup)
The register page already calls `POST /api/lookup-phone` after the user enters their phone number. Today the response shapes the rest of the form (existing seats, credits, etc.).

New rule: if `event.guild_path_exclusive === true` and `lookup.membership.isMember === false`, hide the rest of the registration form and render a gate card in its place:

- Heading: **"Guild Path Exclusive Event"**
- Body: short copy explaining this event is open only to Guild Path members and Guild Path includes access to events like this plus other perks.
- Primary CTA button → `/guild-path` (text: "Join Guild Path")
- Secondary link: "Try a different phone number" — clears the lookup state so the user can re-enter a phone (e.g. spouse's number).

Expired memberships count as non-members. The current `/api/lookup-phone` already returns `isMember: false` for expired rows; this design relies on that behavior and the implementation will verify.

## Admin

### EventDrawer
Add a `guild_path_exclusive` toggle in the event form, sibling to `is_published`. Label: "Guild Path Exclusive". Helper text: "Only current Guild Path members can register on the public site."

The admin `events` create/update payloads (`POST/PATCH /api/admin/events`) accept the new field. The worker handlers pass it through to Supabase.

### ManualRegistrationDrawer
After phone lookup, if the selected event is `guild_path_exclusive` and the looked-up user is not a current guild member, render an inline yellow warning above the submit button:

> ⚠️ This event is Guild Path Exclusive and this user isn't a current member. You can still register them, but consider adding them to Guild Path first.

The submit button stays enabled. Admin manual-registration bypasses the worker's exclusivity check (see below).

## Worker

### `POST /api/register`
After loading the event row, if `event.guild_path_exclusive === true`:

1. Look up the registrant's guild membership using the same logic as `/api/lookup-phone` (active row in `guild_path_members` whose expiry has not passed).
2. If not an active member, return `403` with `{ success: false, error: 'guild_path_required' }`.

This is defense-in-depth; the UI prevents reaching this state.

### Admin manual register
The existing admin manual-registration endpoint (under `/api/admin/registrations/manual` or similar) does **not** apply the exclusivity check. Admin gating is sufficient.

### `POST /api/lookup-phone`
No change. The existing response already carries `membership.isMember`, which the register page uses for the gate.

### Tests
Add a Vitest case in `worker/` covering:
- Exclusive event + non-member → 403 `guild_path_required`.
- Exclusive event + active member → success.
- Non-exclusive event + non-member → success (regression).

## File touch list

- `supabase/migrations/013_event_guild_exclusive.sql` (new)
- `src/lib/types.ts` — extend `Event`
- Event card component(s) used on `/calendar` and the homepage (identify during planning) — badge
- Register page React island (the component owning the phone-lookup → form flow) — gate card
- `admin/src/pages/EventDrawer.tsx` — toggle
- `admin/src/pages/ManualRegistrationDrawer.tsx` — warning
- Admin events endpoint in `worker/src/admin/` — pass-through of new field
- `worker/src/index.ts` — register handler enforcement
- `worker/src/*.test.ts` — new test cases

## Open questions

None.

## Rollout

- Apply migration (defaults all existing events to `false`, so behavior is unchanged for them).
- Deploy worker.
- Deploy site + admin via Pages.
- Admin can then toggle the flag on relevant events.
