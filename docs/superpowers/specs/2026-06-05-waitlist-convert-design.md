# Convert waitlist → registration from the Leads page

**Date:** 2026-06-05
**Status:** Approved, ready for implementation plan

## Problem

Sold-out events collect a waitlist as `leads` rows (`waitlist_at` set, plus
`phone` / `name` / `email` / `seats` already captured by the public waitlist
form). When a spot frees up there is no way to turn a waitlist entry into a real
registration from the admin Leads page — an admin has to retype the person's
details into the manual-registration page. This adds friction for non-coder
admins and risks transcription errors.

## Goal

Let an admin (or an event-scoped guest admin) convert a waitlist lead into a
confirmed/pending registration directly from the Leads page, reusing existing
registration logic.

## Approach

Reuse the existing `/api/admin/registrations/manual` endpoint. Add lead
auto-conversion to it (mirroring the public `/api/register` flow), and add a
convert dialog to the Leads page. **No new worker endpoint, no migration.**

### 1. Worker — `handleManualRegister` marks the matching lead converted

File: `worker/src/admin/register-manual.ts`

After the registration row is created successfully (after `register-manual.ts:171`),
add a best-effort block copied from `worker/src/register.ts:258-274`:

```ts
// Convert any open lead matching this phone+event. Best-effort — failures here
// must not fail the registration.
try {
  await supabase
    .from('leads')
    .update({
      converted_at: new Date().toISOString(),
      registration_id: reg.id,
      updated_at: new Date().toISOString(),
    })
    .eq('phone', phone)
    .eq('event_id', body.event_id)
    .is('converted_at', null)
    .is('junk_at', null);
} catch {
  // swallow
}
```

This makes manual registration consistent with the public flow. Side benefit:
the existing manual-registration page now also clears matching open leads. A
failure here never fails the registration.

No routing or guest-scoping changes. Guests already reach
`/api/admin/registrations/manual` scoped to their events
(`worker/src/guest/index.ts:90-94`), so conversion works for them automatically.

### 2. Admin — convert dialog on waitlist rows

File: `admin/src/pages/Leads.tsx`

- On rows where `waitlist_at` is set, add a **Register** button alongside the
  existing WhatsApp / Junk actions.
- Clicking opens a shadcn `Dialog` prefilled from the lead:
  - `name` — editable text, required (waitlist form collects it, but guard anyway)
  - `email` — editable text, optional
  - `seats` — editable number, default `lead.seats ?? 1`
  - payment status — select, defaults to **Pending**
- Submit → `POST /api/admin/registrations/manual` with
  `{ event_id: lead.event_id, name, phone: lead.phone, email, seats, payment_status, custom_answers: {} }`.
- On success: success toast, close dialog, drop the row from local state (it is
  now converted and hidden by the default filter — no full reload needed).
- On error (e.g. `"Only N spots remaining"` when no spot is actually free): show
  the error message inside the dialog and keep it open so the admin can react.

The waitlist form does not collect custom-question answers, so `custom_answers`
is sent empty; an admin can edit the registration afterward if the event needs
those fields.

### 3. Tests

- Worker (`worker/src/admin/register-manual.test.ts`): assert that after a
  manual register, a matching **open** waitlist lead gets `converted_at` and
  `registration_id` set, and that a **junk** or **already-converted** lead with
  the same phone+event is left untouched.
- Admin: the dialog is light. Add a focused test for the convert button → submit
  path if the existing `Leads` test setup makes it cheap; otherwise rely on the
  worker-side coverage of the manual-register path.

## Out of scope

- Capacity guard stays as-is. Converting when no spot is free correctly returns
  the existing `"Only N spots remaining"` error.
- No FIFO enforcement — the admin chooses who to convert (the list is already
  shown FIFO for the waitlist filter).
- No bulk convert.
- No custom-question capture in the convert dialog.

## Files touched

- `worker/src/admin/register-manual.ts` — add lead-conversion block
- `worker/src/admin/register-manual.test.ts` — add conversion tests
- `admin/src/pages/Leads.tsx` — add Register button + convert dialog
