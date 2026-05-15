# Leads capture — design

**Date:** 2026-05-15
**Status:** approved, pending implementation plan

## Problem

Today, a visitor only enters our system once they complete a full event registration. Anyone who types a phone number or name and then bounces is invisible — we have no way to follow up on WhatsApp or Instagram. We want to capture those partial attempts as **leads** that admins can pursue.

## Goals

- Capture (phone, optional name, optional event-of-interest) as soon as a visitor starts the registration form.
- Auto-mark a lead as converted when the same phone completes a registration for the same event.
- Give admins a `/leads` view to see open leads, age, source, and a one-tap WhatsApp link.
- Silent capture — no extra UI on the public form, no consent friction.

## Non-goals

- Multi-status workflow (open → contacted → not-interested). MVP is just open / converted / junk.
- Cross-event lead deduplication in the UI (one phone × multiple events = multiple rows).
- Outbound messaging from the admin (we deep-link to WhatsApp; we do not send).
- Capturing leads from any flow other than the event registration form.

## Data model

New table via migration `010_leads.sql`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | |
| `phone` | `text` not null | 10-digit Indian, normalised by validation; indexed |
| `name` | `text` nullable | |
| `event_id` | `uuid` not null, FK → `events(id)` | which event they were registering for. Always known because the registration form is per-event. |
| `last_step` | `text` not null | enum-ish: `phone_entered`, `name_entered`, `details_entered` |
| `source` | `jsonb` nullable | UTM/source object from `src/lib/source.ts` |
| `user_agent` | `text` nullable | for spam triage |
| `converted_at` | `timestamptz` nullable | set when a matching registration succeeds |
| `registration_id` | `uuid` nullable, FK → `registrations(id)` | |
| `junk_at` | `timestamptz` nullable | admin soft-delete |
| `created_at` | `timestamptz` not null, default `now()` | |
| `updated_at` | `timestamptz` not null, default `now()` | |

Constraints / indexes:

- `UNIQUE (phone, event_id)` — re-attempts on the same event update one row instead of duplicating.
- Index on `created_at desc` for the admin list.
- Index on `(converted_at, junk_at)` for the default "open leads" filter.

RLS: enabled, no public policies. All access is via the worker (service-role key).

## Worker — public endpoint

New file `worker/src/lead.ts`. Routed in `worker/src/index.ts` alongside other public endpoints.

`POST /api/lead`

**Request body:**

```json
{
  "phone": "9876543210",
  "name": "Asha",
  "event_id": "uuid",
  "last_step": "name_entered",
  "source": { "utm_source": "...", "...": "..." },
  "user_agent": "Mozilla/..."
}
```

**Behavior:**

1. Validate `phone` with the existing 10-digit check from `worker/src/validation.ts`. Reject 400 if invalid.
2. Validate `last_step` ∈ `{phone_entered, name_entered, details_entered}`. Validate `event_id` is a UUID.
3. Best-effort in-isolate rate limit: drop (return `{ ok: true }` without writing) if the same `phone+event_id` was upserted in the last 2s.
4. Upsert into `leads` keyed on `(phone, event_id)`:
   - On insert: set all provided fields plus `created_at`, `updated_at`.
   - On conflict: update `name = COALESCE(EXCLUDED.name, leads.name)` (never null out an existing name), `last_step = EXCLUDED.last_step`, `source = COALESCE(EXCLUDED.source, leads.source)`, `user_agent = EXCLUDED.user_agent`, `updated_at = now()`.
   - Skip the upsert entirely if the existing row has `converted_at IS NOT NULL` (don't reopen converted leads). Return `{ ok: true }` either way.
5. Return `{ ok: true }`. The client treats this as fire-and-forget.

**Auth:** none. Endpoint is public. The phone-validity check + rate limit are the only abuse mitigations for MVP.

## Worker — auto-conversion

In `worker/src/register.ts`, after a successful `registrations` insert, run:

```sql
UPDATE leads
SET converted_at = now(),
    registration_id = $1,
    name = COALESCE(name, $2),
    updated_at = now()
WHERE phone = $3
  AND event_id = $4
  AND converted_at IS NULL
  AND junk_at IS NULL;
```

Idempotent: re-running has no effect because of `converted_at IS NULL`.

Failures here are logged but do not fail the registration.

## Worker — admin endpoints

All under `/api/admin/leads`, gated by the existing `verifyAccessJwt` + `ADMIN_EMAILS` allowlist (same as other admin endpoints). Routed in `worker/src/admin/`.

- `GET /api/admin/leads?event_id=&has_name=&since=&include_converted=&include_junk=`
  - Default filter: `converted_at IS NULL AND junk_at IS NULL`.
  - `since` = ISO date; default = 30 days ago.
  - Returns leads joined with event title, ordered by `created_at desc`, capped at 500 rows.
- `PATCH /api/admin/leads/:id` — body `{ junk: true }` sets `junk_at = now()`. No other mutations in MVP.
- `GET /api/admin/leads/export` — CSV with the same columns the admin sees.

## Frontend — public form

New file `src/lib/use-lead-capture.ts` (React hook). Imported by `src/components/RegistrationForm.tsx`.

```ts
useLeadCapture({ phone, name, eventId, customQuestionsTouched })
```

**Behavior:**

- Watches `phone`, `name`, `customQuestionsTouched` (boolean).
- Computes `last_step`:
  - `details_entered` if any custom question has been touched
  - else `name_entered` if `name` is non-empty
  - else `phone_entered`
- Debounces 1.5s after the last change. Only fires when phone is a valid 10-digit number.
- POSTs to `${PUBLIC_WORKER_URL}/api/lead` with `keepalive: true`. `source` from `src/lib/source.ts`. `user_agent` from `navigator.userAgent`.
- Registers a `beforeunload` listener that fires the same payload one more time (also `keepalive: true`) so tab-close flushes the latest state.
- Silent: no toasts, no UI changes, swallows all errors.

The `lookup-phone` flow is **not** wired to lead capture. Lead capture is purely a side-effect of the registration form being filled out.

## Admin — `/leads` page

New file `admin/src/pages/Leads.tsx`. Add nav entry in the admin shell.

**Table columns:** Age (relative, sortable, default desc), Phone (click to copy), Name (em-dash if null), Event title (em-dash if null), Last step badge, Actions (WhatsApp button, Mark junk button).

**WhatsApp button:** opens `https://wa.me/91{phone}?text={encoded prefilled message}`. Prefilled message includes event title and a friendly nudge — exact copy to be finalised in implementation, but MVP is a single template.

**Filters:** event dropdown (All / specific event), Has name (Yes / No / Any), date range (default last 30d), Show converted toggle (off), Show junk toggle (off).

**Export:** button hits `/api/admin/leads/export`.

Out of scope for MVP: per-phone grouping, status workflow beyond junk, in-admin messaging, bulk actions.

## Tests

`worker/src/lead.test.ts`:

- Creates a lead on first POST.
- Upserts on second POST with same phone+event; preserves existing name when new payload has null name.
- Skips writes when existing row is converted.
- Rejects invalid phone with 400.
- Rate-limit drop within 2s window returns `{ ok: true }` without DB write.

`worker/src/register.test.ts` (extend existing):

- Successful registration converts the matching open lead (sets `converted_at`, `registration_id`).
- Re-running register doesn't re-convert.
- Lead-conversion failure does not fail the registration.

Admin endpoints get smoke tests in the admin test file alongside existing patterns.

## Migration / rollout

- Migration `010_leads.sql` — additive, no risk to existing rows.
- Worker deploy must precede frontend deploy (so the endpoint exists before the form starts calling it). Worker deploy is manual via `wrangler deploy`; site deploy is auto on push to `main`. Order: ship worker first, verify endpoint, then merge frontend changes.
- Admin page can ship in the same Pages auto-deploy as the frontend changes.

## Open questions

None at design time. Implementation may surface UI/copy questions for the WhatsApp prefilled message and the admin filter defaults.
